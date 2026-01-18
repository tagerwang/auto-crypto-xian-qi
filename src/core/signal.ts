/**
 * 信号生成器
 * 
 * 功能：
 * - 开仓信号生成
 * - 平仓信号生成
 * - 结算时间窗口检查
 * - 信号优先级管理
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal, annualizedReturn } from '../utils/decimal.js';
import { SignalsConfig } from '../config/schema.js';
import { RiskManager } from '../risk/manager.js';
import { PositionManager } from './position.js';
import {
  Signal,
  SignalType,
  CloseReason,
  Opportunity,
  ArbitragePosition,
  ArbitragePositionStatus,
  FundingRateInfo,
} from '../types/index.js';
import { signalRepository, positionRepository } from '../db/repository.js';

/**
 * 信号生成器
 */
export class SignalGenerator {
  constructor(
    private readonly config: SignalsConfig,
    private readonly riskManager: RiskManager,
    private readonly positionManager: PositionManager
  ) {}

  // ===========================================
  // 开仓信号
  // ===========================================

  /**
   * 生成开仓信号
   */
  async generateOpenSignal(opportunity: Opportunity): Promise<Signal | null> {
    const { symbol, annualizedReturn: annualized, fundingRate, fundingInterval } = opportunity;

    // 1. 检查年化收益是否达标
    if (annualized.lt(this.config.openAnnualizedThreshold)) {
      logger.debug(
        { symbol, annualized: annualized.toNumber() },
        '年化收益未达到开仓阈值'
      );
      return null;
    }

    // 2. 检查是否在冷却期
    const inCooldown = await signalRepository.isInCooldown(symbol, this.config.cooldownHours);
    if (inCooldown) {
      logger.debug({ symbol }, '标的在冷却期内');
      return null;
    }

    // 3. 检查是否已有该标的的持仓
    const existingPosition = await positionRepository.findActiveBySymbol(symbol);
    if (existingPosition) {
      logger.debug({ symbol }, '已存在该标的持仓');
      return null;
    }

    // 4. 检查是否在结算时间窗口内
    const inSettlementWindow = this.isInSettlementWindow(opportunity.timestamp);
    if (inSettlementWindow) {
      logger.debug({ symbol }, '当前在结算时间窗口内');
      return null;
    }

    // 5. 检查风控限制
    const riskCheck = await this.riskManager.canOpenPosition();
    if (!riskCheck.allowed) {
      logger.debug({ symbol, reason: riskCheck.reason }, '风控检查不通过');
      return null;
    }

    // 生成开仓信号
    const signal: Signal = {
      id: uuidv4(),
      type: SignalType.OPEN,
      symbol,
      timestamp: new Date(),
      annualizedReturn: annualized.toNumber(),
      fundingRate: fundingRate.toNumber(),
      fundingInterval,
      priority: this.calculateOpenPriority(opportunity),
    };

    logger.info(
      {
        symbol,
        annualizedReturn: annualized.toNumber(),
        fundingRate: fundingRate.toNumber(),
      },
      '生成开仓信号'
    );

    // 保存信号到数据库
    await signalRepository.create({
      ...signal,
      status: 'PENDING',
      annualizedReturn: signal.annualizedReturn?.toString() ?? null,
      fundingRate: signal.fundingRate?.toString() ?? null,
    } as any);

    return signal;
  }

  /**
   * 检查是否在结算时间窗口内
   */
  private isInSettlementWindow(fundingTime: Date): boolean {
    const now = Date.now();
    const fundingTimestamp = fundingTime.getTime();
    
    // 结算前 N 分钟
    const blackoutBefore = this.config.settlementWindow.blackoutBeforeMinutes * 60 * 1000;
    // 结算后 N 分钟
    const blackoutAfter = this.config.settlementWindow.blackoutAfterMinutes * 60 * 1000;

    // 找到最近的结算时间点
    // 假设结算周期是 8 小时，则每天有 3 个结算点：0:00, 8:00, 16:00 UTC
    const msPerHour = 60 * 60 * 1000;
    const intervals = [1, 4, 8]; // 可能的结算周期
    
    for (const interval of intervals) {
      const periodMs = interval * msPerHour;
      const timeSinceLastSettlement = now % periodMs;
      const timeToNextSettlement = periodMs - timeSinceLastSettlement;
      
      // 检查是否接近结算时间
      if (timeSinceLastSettlement < blackoutAfter || timeToNextSettlement < blackoutBefore) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算开仓优先级 (0-100, 越高越优先)
   */
  private calculateOpenPriority(opportunity: Opportunity): number {
    return opportunity.overallScore;
  }

  // ===========================================
  // 平仓信号
  // ===========================================

  /**
   * 检查持仓是否需要平仓
   */
  async checkCloseSignal(
    position: ArbitragePosition,
    currentRate?: FundingRateInfo
  ): Promise<Signal | null> {
    // 只检查活跃持仓
    if (position.status !== ArbitragePositionStatus.ACTIVE) {
      return null;
    }

    // 按优先级检查各种平仓条件
    const checks: Array<{
      check: () => Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }>;
    }> = [
      // P0: 止损
      { check: () => this.checkStopLoss(position) },
      // P1: 价差异常
      { check: () => this.checkSpreadStopLoss(position) },
      // P1: 保证金告警
      { check: () => this.checkMarginCall(position) },
      // P2: 止盈
      { check: () => this.checkTakeProfit(position) },
      // P2: 费率下降
      { check: () => this.checkFundingDecline(position, currentRate) },
      // P3: 持仓超时
      { check: () => this.checkHoldingTimeout(position) },
    ];

    for (const { check } of checks) {
      const result = await check();
      if (result.shouldClose) {
        return this.createCloseSignal(position, result.reason, result.priority);
      }
    }

    return null;
  }

  /**
   * 检查止损条件
   */
  private async checkStopLoss(
    position: ArbitragePosition
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    const pnlPct = position.unrealizedPnL.div(
      position.spotEntryPrice.mul(position.spotQuantity)
    );

    const shouldClose = pnlPct.lte(-this.riskManager.config.combinedStopLossPct);

    return {
      shouldClose,
      reason: CloseReason.STOP_LOSS,
      priority: 100, // P0 最高优先级
    };
  }

  /**
   * 检查价差止损
   */
  private async checkSpreadStopLoss(
    position: ArbitragePosition
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    // 需要获取当前价差，这里简化处理
    // 实际应该通过 PositionManager 获取实时价差
    const currentSpread = await this.positionManager.getCurrentSpread(position);
    const shouldClose = currentSpread.abs().gte(this.riskManager.config.spreadStopLossPct);

    return {
      shouldClose,
      reason: CloseReason.SPREAD_STOP_LOSS,
      priority: 90, // P1
    };
  }

  /**
   * 检查保证金告警
   */
  private async checkMarginCall(
    position: ArbitragePosition
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    const marginRatio = await this.riskManager.getMarginRatio();
    const shouldClose = marginRatio.lt(this.riskManager.config.marginCallThreshold);

    return {
      shouldClose,
      reason: CloseReason.MARGIN_CALL,
      priority: 90, // P1
    };
  }

  /**
   * 检查止盈条件
   */
  private async checkTakeProfit(
    position: ArbitragePosition
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    // 累计费率收益 / 持仓价值
    const fundingPct = position.totalFundingCollected.div(
      position.spotEntryPrice.mul(position.spotQuantity)
    );

    const shouldClose = fundingPct.gte(this.riskManager.config.takeProfitFundingPct);

    return {
      shouldClose,
      reason: CloseReason.TAKE_PROFIT,
      priority: 70, // P2
    };
  }

  /**
   * 检查费率下降
   */
  private async checkFundingDecline(
    position: ArbitragePosition,
    currentRate?: FundingRateInfo
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    if (!currentRate) {
      return { shouldClose: false, reason: CloseReason.FUNDING_DECLINE, priority: 70 };
    }

    const currentAnnualized = annualizedReturn(currentRate.fundingRate, currentRate.fundingInterval);
    const shouldClose = currentAnnualized.lt(this.config.closeAnnualizedThreshold);

    return {
      shouldClose,
      reason: CloseReason.FUNDING_DECLINE,
      priority: 70, // P2
    };
  }

  /**
   * 检查持仓超时
   */
  private async checkHoldingTimeout(
    position: ArbitragePosition
  ): Promise<{ shouldClose: boolean; reason: CloseReason; priority: number }> {
    const holdingDays = (Date.now() - position.openedAt.getTime()) / (24 * 60 * 60 * 1000);
    const shouldClose = holdingDays >= this.riskManager.config.maxHoldingDays;

    return {
      shouldClose,
      reason: CloseReason.HOLDING_TIMEOUT,
      priority: 50, // P3
    };
  }

  /**
   * 创建平仓信号
   */
  private async createCloseSignal(
    position: ArbitragePosition,
    reason: CloseReason,
    priority: number
  ): Promise<Signal> {
    const signal: Signal = {
      id: uuidv4(),
      type: SignalType.CLOSE,
      symbol: position.symbol,
      timestamp: new Date(),
      closeReason: reason,
      positionId: position.id,
      priority,
    };

    logger.info(
      {
        symbol: position.symbol,
        positionId: position.id,
        reason,
        priority,
      },
      '生成平仓信号'
    );

    // 保存信号到数据库
    await signalRepository.create({
      ...signal,
      status: 'PENDING',
    } as any);

    return signal;
  }

  /**
   * 手动平仓信号
   */
  async generateManualCloseSignal(positionId: string): Promise<Signal | null> {
    const position = await positionRepository.findById(positionId);
    if (!position) {
      logger.warn({ positionId }, '未找到持仓');
      return null;
    }

    if (position.status !== 'ACTIVE') {
      logger.warn({ positionId, status: position.status }, '持仓状态不是活跃');
      return null;
    }

    return this.createCloseSignal(
      position as unknown as ArbitragePosition,
      CloseReason.MANUAL,
      100 // 手动平仓优先级最高
    );
  }

  /**
   * 紧急平仓信号（平掉所有持仓）
   */
  async generateEmergencyCloseSignals(): Promise<Signal[]> {
    const activePositions = await positionRepository.findActive();
    const signals: Signal[] = [];

    for (const position of activePositions) {
      const signal = await this.createCloseSignal(
        position as unknown as ArbitragePosition,
        CloseReason.EMERGENCY,
        100 // 紧急平仓优先级最高
      );
      signals.push(signal);
    }

    return signals;
  }

  // ===========================================
  // 批量操作
  // ===========================================

  /**
   * 批量生成开仓信号
   */
  async generateOpenSignals(opportunities: Opportunity[]): Promise<Signal[]> {
    const signals: Signal[] = [];

    for (const opp of opportunities) {
      const signal = await this.generateOpenSignal(opp);
      if (signal) {
        signals.push(signal);
      }
    }

    // 按优先级排序
    return signals.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 检查所有持仓的平仓信号
   */
  async checkAllCloseSignals(
    ratesMap: Map<string, FundingRateInfo>
  ): Promise<Signal[]> {
    const activePositions = await positionRepository.findActive();
    const signals: Signal[] = [];

    for (const position of activePositions) {
      const currentRate = ratesMap.get(position.symbol);
      const signal = await this.checkCloseSignal(
        position as unknown as ArbitragePosition,
        currentRate
      );
      if (signal) {
        signals.push(signal);
      }
    }

    // 按优先级排序
    return signals.sort((a, b) => b.priority - a.priority);
  }
}
