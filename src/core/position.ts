/**
 * 持仓管理器
 * 
 * 功能：
 * - 持仓状态管理
 * - 实时盈亏计算
 * - 价差监控
 */

import { BinanceAdapter } from '../adapters/binance/index.js';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal, safeDivide } from '../utils/decimal.js';
import { RiskManager } from '../risk/manager.js';
import { positionRepository, fundingRecordRepository } from '../db/repository.js';
import {
  ArbitragePosition,
  ArbitragePositionStatus,
  FundingRateInfo,
  MarketType,
} from '../types/index.js';
import { calculatePnL, type PnLResult } from '../risk/calculator.js';

/**
 * 持仓管理器
 */
export class PositionManager {
  private positionCache: Map<string, ArbitragePosition> = new Map();
  private lastUpdateTime: Date = new Date();

  constructor(
    private readonly adapter: BinanceAdapter,
    private readonly riskManager: RiskManager
  ) {}

  // ===========================================
  // 持仓查询
  // ===========================================

  /**
   * 获取所有活跃持仓
   */
  async getActivePositions(): Promise<ArbitragePosition[]> {
    const positions = await positionRepository.findActive();
    return positions.map((p) => this.mapToArbitragePosition(p));
  }

  /**
   * 根据 ID 获取持仓
   */
  async getPosition(positionId: string): Promise<ArbitragePosition | null> {
    const position = await positionRepository.findById(positionId);
    return position ? this.mapToArbitragePosition(position) : null;
  }

  /**
   * 根据 symbol 获取活跃持仓
   */
  async getPositionBySymbol(symbol: string): Promise<ArbitragePosition | null> {
    const position = await positionRepository.findActiveBySymbol(symbol);
    return position ? this.mapToArbitragePosition(position) : null;
  }

  /**
   * 获取持仓数量
   */
  async getActivePositionCount(): Promise<number> {
    return positionRepository.countActive();
  }

  // ===========================================
  // 实时数据更新
  // ===========================================

  /**
   * 更新所有持仓的实时数据
   */
  async updateAllPositions(): Promise<void> {
    const positions = await this.getActivePositions();

    for (const position of positions) {
      try {
        await this.updatePositionPnL(position);
      } catch (error) {
        logger.error(
          { positionId: position.id, symbol: position.symbol, error },
          '更新持仓数据失败'
        );
      }
    }

    this.lastUpdateTime = new Date();
  }

  /**
   * 更新单个持仓的盈亏
   */
  async updatePositionPnL(position: ArbitragePosition): Promise<PnLResult> {
    // 获取当前价格
    const [spotBook, futuresBook] = await Promise.all([
      this.adapter.getOrderBook(position.symbol, MarketType.SPOT),
      this.adapter.getOrderBook(position.symbol, MarketType.FUTURES),
    ]);

    const currentSpotPrice = spotBook.bids[0]?.[0] ?? position.spotEntryPrice;
    const currentFuturesPrice = futuresBook.asks[0]?.[0] ?? position.futuresEntryPrice;

    // 计算盈亏
    const pnl = calculatePnL(position, currentSpotPrice, currentFuturesPrice);

    // 更新数据库
    await positionRepository.update(position.id, {
      unrealizedPnl: pnl.combinedPnL.toString(),
    });

    // 更新缓存
    position.unrealizedPnL = pnl.combinedPnL;
    this.positionCache.set(position.id, position);

    return pnl;
  }

  /**
   * 获取当前价差
   */
  async getCurrentSpread(position: ArbitragePosition): Promise<Decimal> {
    const [spotBook, futuresBook] = await Promise.all([
      this.adapter.getOrderBook(position.symbol, MarketType.SPOT),
      this.adapter.getOrderBook(position.symbol, MarketType.FUTURES),
    ]);

    const spotBid = spotBook.bids[0]?.[0] ?? toDecimal(0);
    const futuresAsk = futuresBook.asks[0]?.[0] ?? toDecimal(0);

    // 平仓时的价差：卖出现货价格 vs 买入合约价格
    return safeDivide(futuresAsk.minus(spotBid), spotBid);
  }

  // ===========================================
  // 费率结算记录
  // ===========================================

  /**
   * 记录费率结算
   */
  async recordFundingSettlement(
    position: ArbitragePosition,
    fundingInfo: FundingRateInfo,
    markPrice: Decimal
  ): Promise<void> {
    const positionValue = position.futuresQuantity.mul(markPrice);
    const fundingAmount = positionValue.mul(fundingInfo.fundingRate);

    // 创建费率记录
    await fundingRecordRepository.create({
      positionId: position.id,
      symbol: position.symbol,
      fundingRate: fundingInfo.fundingRate.toString(),
      fundingInterval: fundingInfo.fundingInterval,
      annualizedRate: fundingInfo.fundingRate
        .mul(24 / fundingInfo.fundingInterval)
        .mul(365)
        .toString(),
      scheduledTime: fundingInfo.nextFundingTime,
      settledAt: new Date(),
      markPriceAtSettlement: markPrice.toString(),
      positionSize: position.futuresQuantity.toString(),
      positionValueAtSettlement: positionValue.toString(),
      fundingAmount: fundingAmount.toString(),
      isEstimated: false,
    });

    // 更新持仓累计费率
    const newTotal = position.totalFundingCollected.plus(fundingAmount);
    await positionRepository.update(position.id, {
      totalFundingCollected: newTotal.toString(),
      fundingRecordCount: position.fundingRecordCount + 1,
    });

    logger.info(
      {
        positionId: position.id,
        symbol: position.symbol,
        fundingRate: fundingInfo.fundingRate.toString(),
        fundingAmount: fundingAmount.toString(),
        totalCollected: newTotal.toString(),
      },
      '记录费率结算'
    );
  }

  /**
   * 获取持仓的费率记录
   */
  async getFundingRecords(positionId: string) {
    return fundingRecordRepository.findByPositionId(positionId);
  }

  /**
   * 获取持仓累计费率收益
   */
  async getTotalFundingCollected(positionId: string): Promise<Decimal> {
    const total = await fundingRecordRepository.sumFundingByPositionId(positionId);
    return toDecimal(total);
  }

  // ===========================================
  // 统计信息
  // ===========================================

  /**
   * 获取持仓汇总统计
   */
  async getPositionSummary(): Promise<{
    activeCount: number;
    totalValue: Decimal;
    totalUnrealizedPnL: Decimal;
    totalFundingCollected: Decimal;
  }> {
    const positions = await this.getActivePositions();

    let totalValue = toDecimal(0);
    let totalUnrealizedPnL = toDecimal(0);
    let totalFundingCollected = toDecimal(0);

    for (const position of positions) {
      const value = position.spotEntryPrice.mul(position.spotQuantity);
      totalValue = totalValue.plus(value);
      totalUnrealizedPnL = totalUnrealizedPnL.plus(position.unrealizedPnL);
      totalFundingCollected = totalFundingCollected.plus(position.totalFundingCollected);
    }

    return {
      activeCount: positions.length,
      totalValue,
      totalUnrealizedPnL,
      totalFundingCollected,
    };
  }

  /**
   * 获取历史收益统计
   */
  async getHistoricalStats(): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalRealizedPnL: Decimal;
    avgHoldingDays: number;
    avgReturn: Decimal;
  }> {
    const closedPositions = await positionRepository.findHistory(1000);

    let totalRealizedPnL = toDecimal(0);
    let totalHoldingDays = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    for (const position of closedPositions) {
      const pnl = toDecimal(position.realizedPnl ?? 0);
      totalRealizedPnL = totalRealizedPnL.plus(pnl);

      if (pnl.gt(0)) {
        winningTrades++;
      } else if (pnl.lt(0)) {
        losingTrades++;
      }

      if (position.closedAt && position.openedAt) {
        const holdingMs = new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime();
        totalHoldingDays += holdingMs / (24 * 60 * 60 * 1000);
      }
    }

    const totalTrades = closedPositions.length;
    const avgHoldingDays = totalTrades > 0 ? totalHoldingDays / totalTrades : 0;
    const avgReturn = totalTrades > 0 ? totalRealizedPnL.div(totalTrades) : toDecimal(0);

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalRealizedPnL,
      avgHoldingDays,
      avgReturn,
    };
  }

  // ===========================================
  // 辅助方法
  // ===========================================

  /**
   * 转换数据库记录为 ArbitragePosition
   */
  private mapToArbitragePosition(record: typeof positionRepository extends { findById: (id: string) => Promise<infer T | null> } ? NonNullable<T> : never): ArbitragePosition {
    return {
      id: record.id,
      symbol: record.symbol,
      status: record.status as ArbitragePositionStatus,
      spotQuantity: toDecimal(record.spotQuantity),
      spotEntryPrice: toDecimal(record.spotEntryPrice),
      spotExitPrice: record.spotExitPrice ? toDecimal(record.spotExitPrice) : undefined,
      spotOrderId: record.spotOrderId ?? undefined,
      futuresQuantity: toDecimal(record.futuresQuantity),
      futuresEntryPrice: toDecimal(record.futuresEntryPrice),
      futuresExitPrice: record.futuresExitPrice ? toDecimal(record.futuresExitPrice) : undefined,
      futuresOrderId: record.futuresOrderId ?? undefined,
      fundingInterval: record.fundingInterval,
      totalFundingCollected: toDecimal(record.totalFundingCollected),
      fundingRecordCount: record.fundingRecordCount,
      unrealizedPnL: toDecimal(record.unrealizedPnl),
      realizedPnL: record.realizedPnl ? toDecimal(record.realizedPnl) : undefined,
      openedAt: new Date(record.openedAt),
      closedAt: record.closedAt ? new Date(record.closedAt) : undefined,
      lastUpdatedAt: new Date(record.lastUpdatedAt),
      closeReason: record.closeReason ?? undefined,
      metadata: record.metadata as Record<string, unknown> | undefined,
    };
  }

  /**
   * 获取上次更新时间
   */
  getLastUpdateTime(): Date {
    return this.lastUpdateTime;
  }
}
