/**
 * 风险计算器
 * 
 * 提供各种风险相关的计算方法
 */

import { Decimal, toDecimal, safeDivide } from '../utils/decimal.js';
import { ArbitragePosition } from '../types/index.js';

/**
 * 盈亏计算结果
 */
export interface PnLResult {
  // 现货端盈亏
  spotPnL: Decimal;
  spotPnLPct: Decimal;
  
  // 合约端盈亏
  futuresPnL: Decimal;
  futuresPnLPct: Decimal;
  
  // 费率收益
  fundingIncome: Decimal;
  fundingIncomePct: Decimal;
  
  // 组合盈亏
  combinedPnL: Decimal;
  combinedPnLPct: Decimal;
  
  // 净盈亏（扣除手续费后）
  netPnL: Decimal;
  netPnLPct: Decimal;
}

/**
 * 计算持仓盈亏
 */
export function calculatePnL(
  position: ArbitragePosition,
  currentSpotPrice: Decimal,
  currentFuturesPrice: Decimal,
  estimatedFees: Decimal = toDecimal(0)
): PnLResult {
  // 持仓价值
  const positionValue = position.spotEntryPrice.mul(position.spotQuantity);

  // 现货端盈亏（做多）
  const spotPnL = currentSpotPrice.minus(position.spotEntryPrice).mul(position.spotQuantity);
  const spotPnLPct = safeDivide(spotPnL, positionValue);

  // 合约端盈亏（做空）
  const futuresPnL = position.futuresEntryPrice.minus(currentFuturesPrice).mul(position.futuresQuantity);
  const futuresPnLPct = safeDivide(futuresPnL, positionValue);

  // 费率收益
  const fundingIncome = position.totalFundingCollected;
  const fundingIncomePct = safeDivide(fundingIncome, positionValue);

  // 组合盈亏
  const combinedPnL = spotPnL.plus(futuresPnL).plus(fundingIncome);
  const combinedPnLPct = safeDivide(combinedPnL, positionValue);

  // 净盈亏
  const netPnL = combinedPnL.minus(estimatedFees);
  const netPnLPct = safeDivide(netPnL, positionValue);

  return {
    spotPnL,
    spotPnLPct,
    futuresPnL,
    futuresPnLPct,
    fundingIncome,
    fundingIncomePct,
    combinedPnL,
    combinedPnLPct,
    netPnL,
    netPnLPct,
  };
}

/**
 * 计算盈亏平衡点
 */
export function calculateBreakEven(params: {
  positionValue: Decimal;
  spotFeeRate: Decimal;
  futuresFeeRate: Decimal;
  fundingRate: Decimal;
  fundingInterval: number;
}): {
  totalFeeRate: Decimal;
  breakEvenSettlements: number;
  breakEvenHours: number;
} {
  const { positionValue, spotFeeRate, futuresFeeRate, fundingRate, fundingInterval } = params;

  // 总手续费率 = (现货费率 + 合约费率) × 2（开仓 + 平仓）
  const totalFeeRate = spotFeeRate.plus(futuresFeeRate).mul(2);

  // 盈亏平衡所需结算次数
  const breakEvenSettlements = safeDivide(totalFeeRate, fundingRate).toNumber();

  // 盈亏平衡时间（小时）
  const breakEvenHours = breakEvenSettlements * fundingInterval;

  return {
    totalFeeRate,
    breakEvenSettlements,
    breakEvenHours,
  };
}

/**
 * 计算预期年化收益
 */
export function calculateExpectedAnnualReturn(params: {
  fundingRate: Decimal;
  fundingInterval: number;
  totalFeeRate: Decimal;
  avgHoldingDays: number;
}): Decimal {
  const { fundingRate, fundingInterval, totalFeeRate, avgHoldingDays } = params;

  // 每日结算次数
  const dailySettlements = 24 / fundingInterval;

  // 每日毛收益
  const dailyGrossReturn = fundingRate.mul(dailySettlements);

  // 平均每日手续费成本（分摊到持仓天数）
  const dailyFeeCost = safeDivide(totalFeeRate, toDecimal(avgHoldingDays));

  // 每日净收益
  const dailyNetReturn = dailyGrossReturn.minus(dailyFeeCost);

  // 年化收益
  return dailyNetReturn.mul(365);
}

/**
 * 计算夏普比率
 */
export function calculateSharpeRatio(
  returns: Decimal[],
  riskFreeRate: Decimal = toDecimal(0.02) // 默认 2% 无风险利率
): Decimal {
  if (returns.length < 2) {
    return toDecimal(0);
  }

  // 计算平均收益
  const avgReturn = returns.reduce((sum, r) => sum.plus(r), toDecimal(0)).div(returns.length);

  // 计算标准差
  const squaredDiffs = returns.map((r) => r.minus(avgReturn).pow(2));
  const variance = squaredDiffs.reduce((sum, d) => sum.plus(d), toDecimal(0)).div(returns.length);
  const stdDev = variance.sqrt();

  if (stdDev.isZero()) {
    return toDecimal(0);
  }

  // 夏普比率 = (平均收益 - 无风险利率) / 标准差
  return avgReturn.minus(riskFreeRate).div(stdDev);
}

/**
 * 计算最大回撤
 */
export function calculateMaxDrawdown(equityCurve: Decimal[]): {
  maxDrawdown: Decimal;
  maxDrawdownPct: Decimal;
  peakIndex: number;
  troughIndex: number;
} {
  if (equityCurve.length < 2) {
    return {
      maxDrawdown: toDecimal(0),
      maxDrawdownPct: toDecimal(0),
      peakIndex: 0,
      troughIndex: 0,
    };
  }

  let maxDrawdown = toDecimal(0);
  let maxDrawdownPct = toDecimal(0);
  let peak = equityCurve[0]!;
  let peakIndex = 0;
  let troughIndex = 0;
  let currentPeakIndex = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    const equity = equityCurve[i]!;
    
    if (equity.gt(peak)) {
      peak = equity;
      currentPeakIndex = i;
    } else {
      const drawdown = peak.minus(equity);
      const drawdownPct = safeDivide(drawdown, peak);
      
      if (drawdownPct.gt(maxDrawdownPct)) {
        maxDrawdown = drawdown;
        maxDrawdownPct = drawdownPct;
        peakIndex = currentPeakIndex;
        troughIndex = i;
      }
    }
  }

  return {
    maxDrawdown,
    maxDrawdownPct,
    peakIndex,
    troughIndex,
  };
}

/**
 * 计算仓位风险评分 (0-100)
 */
export function calculatePositionRiskScore(params: {
  pnlPct: Decimal;
  holdingDays: number;
  fundingTrend: 'UP' | 'DOWN' | 'STABLE';
  spreadPct: Decimal;
  marginRatio: Decimal;
}): number {
  const { pnlPct, holdingDays, fundingTrend, spreadPct, marginRatio } = params;
  let score = 0;

  // 盈亏风险 (0-30)
  if (pnlPct.lt(-0.01)) {
    score += Math.min(30, pnlPct.abs().mul(1000).toNumber());
  }

  // 持仓时间风险 (0-20)
  score += Math.min(20, holdingDays * 1.5);

  // 费率趋势风险 (0-20)
  if (fundingTrend === 'DOWN') {
    score += 20;
  } else if (fundingTrend === 'STABLE') {
    score += 5;
  }

  // 价差风险 (0-15)
  score += Math.min(15, spreadPct.mul(1000).toNumber());

  // 保证金风险 (0-15)
  if (marginRatio.lt(0.2)) {
    score += 15;
  } else if (marginRatio.lt(0.3)) {
    score += 10;
  } else if (marginRatio.lt(0.5)) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}
