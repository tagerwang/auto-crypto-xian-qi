/**
 * 回测引擎
 * 
 * 功能：
 * - 模拟市场扫描和信号生成
 * - 模拟订单执行
 * - 资金曲线记录
 * - 性能指标计算
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal, annualizedReturn, safeDivide, decimalMin } from '../utils/decimal.js';
import { DataLoader, HistoricalData } from './data-loader.js';
import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
} from '../risk/calculator.js';
import { BacktestResult, FundingRateInfo } from '../types/index.js';

/** 回测运行配置（扩展配置文件中的 BacktestConfig） */
export interface BacktestRunConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols?: string[];
  commission?: {
    spotMaker: number;
    spotTaker: number;
    futuresMaker: number;
    futuresTaker: number;
    useBnbDiscount: boolean;
  };
  slippage?: {
    model: 'FIXED' | 'VOLUME_BASED' | 'ORDERBOOK_BASED';
    fixedPct?: number;
    volumeBased?: {
      baseSlippage: number;
      volumeMultiplier: number;
    };
  };
  signals?: {
    openAnnualizedThreshold?: number;
    closeAnnualizedThreshold?: number;
  };
  risk?: {
    maxPositions?: number;
    maxPositionPct?: number;
    minPositionValue?: number;
    takeProfitFundingPct?: number;
    maxHoldingDays?: number;
  };
}

interface SimulatedPosition {
  id: string;
  symbol: string;
  quantity: Decimal;
  entryPrice: Decimal;
  entryTime: Date;
  fundingInterval: number;
  fundingCollected: Decimal;
  fundingCount: number;
}

interface BacktestState {
  capital: Decimal;
  positions: Map<string, SimulatedPosition>;
  closedPositions: SimulatedPosition[];
  equityCurve: Array<{ date: Date; equity: Decimal }>;
  trades: Array<{
    symbol: string;
    entryTime: Date;
    exitTime: Date;
    entryPrice: Decimal;
    exitPrice: Decimal;
    quantity: Decimal;
    fundingCollected: Decimal;
    pnl: Decimal;
    pnlPct: Decimal;
  }>;
}

/**
 * 回测引擎
 */
export class BacktestEngine {
  private state!: BacktestState;
  private config!: BacktestRunConfig;

  constructor(private readonly dataLoader: DataLoader) {}

  /**
   * 运行回测
   */
  async run(config: BacktestRunConfig): Promise<BacktestResult> {
    const startTime = Date.now();
    this.config = config;
    
    logger.info(
      {
        startDate: config.startDate.toISOString(),
        endDate: config.endDate.toISOString(),
        initialCapital: config.initialCapital,
      },
      '开始回测'
    );

    // 初始化状态
    this.initState(config.initialCapital);

    // 加载历史数据
    const symbols = config.symbols ?? await this.dataLoader.getAvailableSymbols();
    const historicalData = await this.dataLoader.loadHistoricalData(
      symbols,
      config.startDate,
      config.endDate
    );

    // 运行回测模拟
    await this.simulate(historicalData);

    // 计算结果
    const result = this.calculateResults(config, startTime);

    logger.info(
      {
        totalReturn: result.totalReturn,
        annualizedReturn: result.annualizedReturn,
        maxDrawdown: result.maxDrawdown,
        totalTrades: result.totalTrades,
      },
      '回测完成'
    );

    return result;
  }

  /**
   * 初始化状态
   */
  private initState(initialCapital: number): void {
    this.state = {
      capital: toDecimal(initialCapital),
      positions: new Map(),
      closedPositions: [],
      equityCurve: [{ date: this.config.startDate, equity: toDecimal(initialCapital) }],
      trades: [],
    };
  }

  /**
   * 运行模拟
   */
  private async simulate(data: HistoricalData): Promise<void> {
    // 获取所有时间点
    const timePoints = this.getTimePoints(data);

    for (const timestamp of timePoints) {
      // 1. 检查平仓条件
      await this.checkCloseConditions(timestamp, data);

      // 2. 处理费率结算
      await this.processFundingSettlement(timestamp, data);

      // 3. 扫描开仓机会
      await this.scanOpportunities(timestamp, data);

      // 4. 记录权益
      this.recordEquity(timestamp);
    }
  }

  /**
   * 获取所有时间点
   */
  private getTimePoints(data: HistoricalData): Date[] {
    const timeSet = new Set<number>();

    for (const rates of data.fundingRates.values()) {
      for (const rate of rates) {
        timeSet.add(rate.timestamp.getTime());
      }
    }

    return Array.from(timeSet)
      .sort((a, b) => a - b)
      .map((t) => new Date(t));
  }

  /**
   * 检查平仓条件
   */
  private async checkCloseConditions(timestamp: Date, data: HistoricalData): Promise<void> {
    for (const [symbol, position] of this.state.positions) {
      const rates = data.fundingRates.get(symbol);
      if (!rates) continue;

      const currentRate = rates.find((r) => r.timestamp.getTime() <= timestamp.getTime());
      if (!currentRate) continue;

      // 检查费率下降
      const currentAnnualized = annualizedReturn(currentRate.fundingRate, position.fundingInterval);
      if (currentAnnualized.lt(this.config.signals?.closeAnnualizedThreshold ?? 0.1)) {
        this.closePosition(symbol, currentRate.markPrice, timestamp, 'FUNDING_DECLINE');
        continue;
      }

      // 检查止盈
      const fundingPct = safeDivide(
        position.fundingCollected,
        position.entryPrice.mul(position.quantity)
      );
      if (fundingPct.gte(this.config.risk?.takeProfitFundingPct ?? 0.03)) {
        this.closePosition(symbol, currentRate.markPrice, timestamp, 'TAKE_PROFIT');
        continue;
      }

      // 检查持仓超时
      const holdingDays = (timestamp.getTime() - position.entryTime.getTime()) / (24 * 60 * 60 * 1000);
      if (holdingDays >= (this.config.risk?.maxHoldingDays ?? 14)) {
        this.closePosition(symbol, currentRate.markPrice, timestamp, 'HOLDING_TIMEOUT');
      }
    }
  }

  /**
   * 处理费率结算
   */
  private async processFundingSettlement(timestamp: Date, data: HistoricalData): Promise<void> {
    for (const [symbol, position] of this.state.positions) {
      const rates = data.fundingRates.get(symbol);
      if (!rates) continue;

      // 找到当前时间点的费率
      const rate = rates.find((r) => r.timestamp.getTime() === timestamp.getTime());
      if (!rate) continue;

      // 计算费率收益
      const positionValue = position.quantity.mul(rate.markPrice);
      const fundingAmount = positionValue.mul(rate.fundingRate);

      // 更新持仓
      position.fundingCollected = position.fundingCollected.plus(fundingAmount);
      position.fundingCount++;
    }
  }

  /**
   * 扫描开仓机会
   */
  private async scanOpportunities(timestamp: Date, data: HistoricalData): Promise<void> {
    // 检查是否还有空闲资金和仓位
    const maxPositions = this.config.risk?.maxPositions ?? 5;
    if (this.state.positions.size >= maxPositions) return;

    const availableCapital = this.calculateAvailableCapital();
    const minPositionValue = this.config.risk?.minPositionValue ?? 100;
    if (availableCapital.lt(minPositionValue)) return;

    // 筛选机会
    const opportunities: Array<{ symbol: string; rate: FundingRateInfo; score: number }> = [];

    for (const [symbol, rates] of data.fundingRates) {
      // 跳过已持仓的标的
      if (this.state.positions.has(symbol)) continue;

      const rate = rates.find((r) => r.timestamp.getTime() <= timestamp.getTime());
      if (!rate) continue;

      // 检查年化收益
      const annualized = annualizedReturn(rate.fundingRate, rate.fundingInterval);
      const minReturn = this.config.signals?.openAnnualizedThreshold ?? 0.3;
      if (annualized.lt(minReturn)) continue;

      // 检查费率为正
      if (rate.fundingRate.lte(0)) continue;

      opportunities.push({
        symbol,
        rate,
        score: annualized.toNumber(),
      });
    }

    // 按评分排序，选择最优机会
    opportunities.sort((a, b) => b.score - a.score);

    for (const opp of opportunities.slice(0, maxPositions - this.state.positions.size)) {
      this.openPosition(opp.symbol, opp.rate, timestamp);
    }
  }

  /**
   * 开仓
   */
  private openPosition(symbol: string, rate: FundingRateInfo, timestamp: Date): void {
    const availableCapital = this.calculateAvailableCapital();
    const maxPositionPct = this.config.risk?.maxPositionPct ?? 0.15;
    const positionValue = decimalMin(
      availableCapital.mul(maxPositionPct),
      this.state.capital.mul(maxPositionPct)
    );

    if (positionValue.lt(this.config.risk?.minPositionValue ?? 100)) return;

    // 计算数量
    const price = rate.markPrice;
    const quantity = safeDivide(positionValue, price);

    // 计算开仓手续费
    const fees = this.calculateOpenFees(positionValue);
    
    // 创建持仓
    const position: SimulatedPosition = {
      id: uuidv4(),
      symbol,
      quantity,
      entryPrice: price,
      entryTime: timestamp,
      fundingInterval: rate.fundingInterval,
      fundingCollected: toDecimal(0),
      fundingCount: 0,
    };

    this.state.positions.set(symbol, position);
    this.state.capital = this.state.capital.minus(positionValue).minus(fees);

    logger.debug(
      { symbol, quantity: quantity.toString(), price: price.toString() },
      '回测开仓'
    );
  }

  /**
   * 平仓
   */
  private closePosition(
    symbol: string,
    exitPrice: Decimal,
    timestamp: Date,
    reason: string
  ): void {
    const position = this.state.positions.get(symbol);
    if (!position) return;

    // 计算盈亏
    const positionValue = position.quantity.mul(exitPrice);
    const entryValue = position.quantity.mul(position.entryPrice);
    
    // 价格变动（理论上接近 0）
    const pricePnL = exitPrice.minus(position.entryPrice).mul(position.quantity);
    
    // 总盈亏 = 费率收益 + 价格变动
    const totalPnL = position.fundingCollected.plus(pricePnL);
    
    // 手续费
    const fees = this.calculateCloseFees(positionValue);
    const netPnL = totalPnL.minus(fees);

    // 记录交易
    this.state.trades.push({
      symbol,
      entryTime: position.entryTime,
      exitTime: timestamp,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      fundingCollected: position.fundingCollected,
      pnl: netPnL,
      pnlPct: safeDivide(netPnL, entryValue),
    });

    // 更新资金
    this.state.capital = this.state.capital.plus(positionValue).plus(netPnL);

    // 移除持仓
    this.state.positions.delete(symbol);
    this.state.closedPositions.push(position);

    logger.debug(
      {
        symbol,
        reason,
        pnl: netPnL.toString(),
        fundingCollected: position.fundingCollected.toString(),
      },
      '回测平仓'
    );
  }

  /**
   * 计算可用资金
   */
  private calculateAvailableCapital(): Decimal {
    return this.state.capital;
  }

  /**
   * 计算开仓手续费
   */
  private calculateOpenFees(value: Decimal): Decimal {
    const spotFee = value.mul(this.config.commission?.spotTaker ?? 0.001);
    const futuresFee = value.mul(this.config.commission?.futuresTaker ?? 0.0004);
    return spotFee.plus(futuresFee);
  }

  /**
   * 计算平仓手续费
   */
  private calculateCloseFees(value: Decimal): Decimal {
    return this.calculateOpenFees(value); // 相同计算方式
  }

  /**
   * 记录权益
   */
  private recordEquity(timestamp: Date): void {
    let equity = this.state.capital;

    // 加上持仓市值（简化处理，使用入场价）
    for (const position of this.state.positions.values()) {
      equity = equity.plus(position.quantity.mul(position.entryPrice));
      equity = equity.plus(position.fundingCollected);
    }

    this.state.equityCurve.push({ date: timestamp, equity });
  }

  /**
   * 计算结果
   */
  private calculateResults(config: BacktestRunConfig, startTime: number): BacktestResult {
    const initialCapital = toDecimal(config.initialCapital);
    const finalEquity = this.state.equityCurve[this.state.equityCurve.length - 1]?.equity ?? initialCapital;

    // 总收益
    const totalReturn = safeDivide(finalEquity.minus(initialCapital), initialCapital).toNumber();

    // 年化收益
    const days = (config.endDate.getTime() - config.startDate.getTime()) / (24 * 60 * 60 * 1000);
    const annualizedReturnValue = totalReturn * (365 / days);

    // 收益率序列（用于计算夏普比率）
    const returns: Decimal[] = [];
    for (let i = 1; i < this.state.equityCurve.length; i++) {
      const prev = this.state.equityCurve[i - 1]!;
      const curr = this.state.equityCurve[i]!;
      returns.push(safeDivide(curr.equity.minus(prev.equity), prev.equity));
    }

    // 夏普比率
    const sharpeRatio = calculateSharpeRatio(returns);

    // 最大回撤
    const equityValues = this.state.equityCurve.map((e) => e.equity);
    const { maxDrawdownPct } = calculateMaxDrawdown(equityValues);

    // 交易统计
    const trades = this.state.trades;
    const winningTrades = trades.filter((t) => t.pnl.gt(0)).length;
    const losingTrades = trades.filter((t) => t.pnl.lt(0)).length;
    const winRate = trades.length > 0 ? winningTrades / trades.length : 0;

    // 盈亏比
    const avgWin = trades.filter((t) => t.pnl.gt(0)).reduce(
      (sum, t) => sum.plus(t.pnl),
      toDecimal(0)
    );
    const avgLoss = trades.filter((t) => t.pnl.lt(0)).reduce(
      (sum, t) => sum.plus(t.pnl.abs()),
      toDecimal(0)
    );
    const profitFactor = avgLoss.isZero() ? null : avgWin.div(avgLoss).toNumber();

    // 策略特有指标
    const totalFundingCollected = trades.reduce(
      (sum, t) => sum.plus(t.fundingCollected),
      toDecimal(0)
    );
    const avgHoldingDays = trades.length > 0
      ? trades.reduce(
          (sum, t) => sum + (t.exitTime.getTime() - t.entryTime.getTime()) / (24 * 60 * 60 * 1000),
          0
        ) / trades.length
      : 0;

    return {
      id: uuidv4(),
      config: config as any,
      totalReturn,
      annualizedReturn: annualizedReturnValue,
      sharpeRatio: sharpeRatio.toNumber(),
      maxDrawdown: maxDrawdownPct.toNumber(),
      winRate,
      profitFactor: profitFactor ?? 0,
      totalFundingCollected: totalFundingCollected.toNumber(),
      avgHoldingPeriodDays: avgHoldingDays,
      capitalUtilization: 0.5, // 简化处理
      fundingIncomeRatio: safeDivide(totalFundingCollected, finalEquity.minus(initialCapital)).toNumber(),
      spreadLoss: 0, // 简化处理
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      avgTradeReturn: trades.length > 0
        ? trades.reduce((sum, t) => sum.plus(t.pnlPct), toDecimal(0)).div(trades.length).toNumber()
        : 0,
      equityCurve: this.state.equityCurve.map((e) => ({
        date: e.date,
        equity: e.equity.toNumber(),
      })),
      executedAt: new Date(),
      durationMs: Date.now() - startTime,
    } as BacktestResult;
  }
}
