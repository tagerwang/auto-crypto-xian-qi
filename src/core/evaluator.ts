/**
 * 机会评估器
 * 
 * 功能：
 * - 深度评估套利机会
 * - 价差分析
 * - 流动性评估
 * - 费率趋势分析
 */

import { BinanceAdapter } from '../adapters/binance/index.js';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal, annualizedReturn, average } from '../utils/decimal.js';
import { StrategyConfig } from '../config/schema.js';
import { Opportunity, MarketType, FundingRateInfo } from '../types/index.js';

export interface EvaluationResult {
  opportunity: Opportunity;
  isValid: boolean;
  reasons: string[];
  details: {
    spreadCheck: SpreadCheckResult;
    liquidityCheck: LiquidityCheckResult;
    trendCheck: TrendCheckResult;
    riskScore: number;
  };
}

interface SpreadCheckResult {
  spotBidPrice: Decimal;
  spotAskPrice: Decimal;
  futuresBidPrice: Decimal;
  futuresAskPrice: Decimal;
  entrySpread: Decimal;  // 开仓价差（现货买入 vs 合约卖出）
  exitSpread: Decimal;   // 平仓价差（现货卖出 vs 合约买入）
  totalSpreadCost: Decimal;
  passed: boolean;
}

interface LiquidityCheckResult {
  spotDepthScore: number;
  futuresDepthScore: number;
  overallScore: number;
  passed: boolean;
}

interface TrendCheckResult {
  recentRates: FundingRateInfo[];
  avgRate: Decimal;
  trend: 'UP' | 'DOWN' | 'STABLE';
  passed: boolean;
}

/**
 * 机会评估器
 */
export class Evaluator {
  constructor(
    private readonly adapter: BinanceAdapter,
    private readonly config: StrategyConfig
  ) {}

  /**
   * 评估单个机会
   */
  async evaluate(opportunity: Opportunity): Promise<EvaluationResult> {
    const reasons: string[] = [];
    let isValid = true;

    logger.debug({ symbol: opportunity.symbol }, '开始评估机会');

    // 1. 价差检查
    const spreadCheck = await this.checkSpread(opportunity.symbol);
    if (!spreadCheck.passed) {
      isValid = false;
      reasons.push(`价差过大: ${spreadCheck.totalSpreadCost.mul(100).toFixed(2)}%`);
    }

    // 2. 流动性检查
    const liquidityCheck = await this.checkLiquidity(opportunity.symbol);
    if (!liquidityCheck.passed) {
      isValid = false;
      reasons.push(`流动性不足: 评分 ${liquidityCheck.overallScore.toFixed(0)}`);
    }

    // 3. 趋势检查
    const trendCheck = await this.checkTrend(opportunity.symbol);
    if (!trendCheck.passed) {
      isValid = false;
      reasons.push(`费率趋势不佳: ${trendCheck.trend}`);
    }

    // 计算风险评分
    const riskScore = this.calculateRiskScore(spreadCheck, liquidityCheck, trendCheck);

    const result: EvaluationResult = {
      opportunity,
      isValid,
      reasons,
      details: {
        spreadCheck,
        liquidityCheck,
        trendCheck,
        riskScore,
      },
    };

    logger.debug(
      {
        symbol: opportunity.symbol,
        isValid,
        riskScore,
        reasons,
      },
      '机会评估完成'
    );

    return result;
  }

  /**
   * 批量评估机会
   */
  async evaluateMany(opportunities: Opportunity[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    for (const opp of opportunities) {
      try {
        const result = await this.evaluate(opp);
        results.push(result);
      } catch (error) {
        logger.error({ symbol: opp.symbol, error }, '评估机会失败');
      }
    }

    // 按风险评分排序（风险越低越好）
    return results.sort((a, b) => a.details.riskScore - b.details.riskScore);
  }

  /**
   * 检查价差
   */
  private async checkSpread(symbol: string): Promise<SpreadCheckResult> {
    const [spotBook, futuresBook] = await Promise.all([
      this.adapter.getOrderBook(symbol, MarketType.SPOT),
      this.adapter.getOrderBook(symbol, MarketType.FUTURES),
    ]);

    const spotBid = spotBook.bids[0]?.[0] ?? toDecimal(0);
    const spotAsk = spotBook.asks[0]?.[0] ?? toDecimal(0);
    const futuresBid = futuresBook.bids[0]?.[0] ?? toDecimal(0);
    const futuresAsk = futuresBook.asks[0]?.[0] ?? toDecimal(0);

    // 开仓价差：现货买入价 vs 合约卖出价
    // 我们买入现货（用 ask 价），卖出合约（用 bid 价）
    const entrySpread = spotAsk.isZero()
      ? toDecimal(0)
      : spotAsk.minus(futuresBid).div(spotAsk);

    // 平仓价差：现货卖出价 vs 合约买入价
    // 我们卖出现货（用 bid 价），买入合约（用 ask 价）
    const exitSpread = spotBid.isZero()
      ? toDecimal(0)
      : futuresAsk.minus(spotBid).div(spotBid);

    // 总价差成本（绝对值之和）
    const totalSpreadCost = entrySpread.abs().plus(exitSpread.abs());

    // 价差应该在阈值内
    const passed = totalSpreadCost.lte(this.config.scanner.maxSpreadPct * 2);

    return {
      spotBidPrice: spotBid,
      spotAskPrice: spotAsk,
      futuresBidPrice: futuresBid,
      futuresAskPrice: futuresAsk,
      entrySpread,
      exitSpread,
      totalSpreadCost,
      passed,
    };
  }

  /**
   * 检查流动性
   */
  private async checkLiquidity(symbol: string): Promise<LiquidityCheckResult> {
    const [spotBook, futuresBook] = await Promise.all([
      this.adapter.getOrderBook(symbol, MarketType.SPOT),
      this.adapter.getOrderBook(symbol, MarketType.FUTURES),
    ]);

    // 计算深度评分（前 5 档总量）
    const spotDepth = this.calculateDepthValue(spotBook.bids.slice(0, 5), spotBook.asks.slice(0, 5));
    const futuresDepth = this.calculateDepthValue(futuresBook.bids.slice(0, 5), futuresBook.asks.slice(0, 5));

    // 评分（假设 $1M 深度为满分）
    const targetDepth = 1_000_000;
    const spotDepthScore = Math.min(100, (spotDepth / targetDepth) * 100);
    const futuresDepthScore = Math.min(100, (futuresDepth / targetDepth) * 100);

    // 综合评分（取较低者）
    const overallScore = Math.min(spotDepthScore, futuresDepthScore);

    // 至少 50 分才通过
    const passed = overallScore >= 20;

    return {
      spotDepthScore,
      futuresDepthScore,
      overallScore,
      passed,
    };
  }

  /**
   * 计算深度价值
   */
  private calculateDepthValue(
    bids: Array<[Decimal, Decimal]>,
    asks: Array<[Decimal, Decimal]>
  ): number {
    let totalValue = 0;

    for (const [price, qty] of bids) {
      totalValue += price.mul(qty).toNumber();
    }
    for (const [price, qty] of asks) {
      totalValue += price.mul(qty).toNumber();
    }

    return totalValue;
  }

  /**
   * 检查费率趋势
   */
  private async checkTrend(symbol: string): Promise<TrendCheckResult> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 最近 24 小时

    const recentRates = await this.adapter.getFundingRateHistory(symbol, startTime, endTime);

    if (recentRates.length < 3) {
      // 数据不足，无法判断趋势
      return {
        recentRates,
        avgRate: toDecimal(0),
        trend: 'STABLE',
        passed: true, // 数据不足时默认通过
      };
    }

    // 计算平均费率
    const avgRate = average(...recentRates.map((r) => r.fundingRate));

    // 判断趋势（最近 3 次费率的变化）
    const last3 = recentRates.slice(-3);
    let upCount = 0;
    let downCount = 0;

    for (let i = 1; i < last3.length; i++) {
      const prev = last3[i - 1];
      const current = last3[i];
      if (prev && current) {
        if (current.fundingRate.gt(prev.fundingRate)) {
          upCount++;
        } else if (current.fundingRate.lt(prev.fundingRate)) {
          downCount++;
        }
      }
    }

    let trend: 'UP' | 'DOWN' | 'STABLE';
    if (upCount > downCount) {
      trend = 'UP';
    } else if (downCount > upCount) {
      trend = 'DOWN';
    } else {
      trend = 'STABLE';
    }

    // 下降趋势且费率较低时不通过
    const passed = !(trend === 'DOWN' && avgRate.lt(this.config.signals.closeAnnualizedThreshold / 365));

    return {
      recentRates,
      avgRate,
      trend,
      passed,
    };
  }

  /**
   * 计算风险评分 (0-100, 越低越好)
   */
  private calculateRiskScore(
    spreadCheck: SpreadCheckResult,
    liquidityCheck: LiquidityCheckResult,
    trendCheck: TrendCheckResult
  ): number {
    let score = 0;

    // 价差风险 (0-40)
    const spreadRisk = spreadCheck.totalSpreadCost.mul(100).toNumber();
    score += Math.min(40, spreadRisk * 10);

    // 流动性风险 (0-30)
    score += Math.max(0, 30 - liquidityCheck.overallScore * 0.3);

    // 趋势风险 (0-30)
    if (trendCheck.trend === 'DOWN') {
      score += 30;
    } else if (trendCheck.trend === 'STABLE') {
      score += 10;
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * 计算预期收益
   */
  calculateExpectedReturn(
    opportunity: Opportunity,
    holdingDays: number = 7
  ): {
    grossReturn: Decimal;
    netReturn: Decimal;
    breakEvenDays: number;
  } {
    // 每日费率收益
    const dailySettlements = 24 / opportunity.fundingInterval;
    const dailyReturn = opportunity.fundingRate.mul(dailySettlements);

    // 毛收益
    const grossReturn = dailyReturn.mul(holdingDays);

    // 手续费成本
    const commission = (this.config as any).backtest?.commission ?? {
      spotTaker: 0.001,
      futuresTaker: 0.0004,
    };
    const totalFees = (commission.spotTaker * 2) + (commission.futuresTaker * 2);

    // 价差成本（假设与机会评估时相近）
    const spreadCost = opportunity.spreadPct.mul(2);

    // 净收益
    const netReturn = grossReturn.minus(totalFees).minus(spreadCost);

    // 盈亏平衡天数
    const dailyNet = dailyReturn.minus(toDecimal(totalFees + spreadCost.toNumber()).div(holdingDays));
    const breakEvenDays = dailyNet.gt(0)
      ? toDecimal(totalFees).plus(spreadCost).div(dailyReturn).toNumber()
      : Infinity;

    return {
      grossReturn,
      netReturn,
      breakEvenDays,
    };
  }
}
