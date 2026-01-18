/**
 * 高精度数值计算工具
 * 
 * 使用 decimal.js 避免 JavaScript 浮点数精度问题
 * 在加密货币交易中，精度至关重要
 */

import * as DecimalModule from 'decimal.js';

// 获取 Decimal 构造函数
const DecimalJS = DecimalModule.default || DecimalModule;

// 配置 Decimal.js
(DecimalJS as any).set({
  precision: 20,
  rounding: (DecimalJS as any).ROUND_DOWN,
  toExpNeg: -9,
  toExpPos: 21,
});

// 导出类型
export type Decimal = DecimalModule.default;

// 导出构造函数
export const Decimal = DecimalJS as typeof DecimalModule.default;

/**
 * 创建 Decimal 实例
 */
export function toDecimal(value: string | number | Decimal): Decimal {
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return value;
  }
  return new (DecimalJS as any)(value);
}

/**
 * 安全除法（避免除以零）
 */
export function safeDivide(
  numerator: Decimal | string | number,
  denominator: Decimal | string | number,
  defaultValue: Decimal | string | number = 0
): Decimal {
  const num = toDecimal(numerator);
  const den = toDecimal(denominator);
  
  if (den.isZero()) {
    return toDecimal(defaultValue);
  }
  
  return num.div(den);
}

/**
 * 计算百分比变化
 */
export function percentChange(
  oldValue: Decimal | string | number,
  newValue: Decimal | string | number
): Decimal {
  const old = toDecimal(oldValue);
  const current = toDecimal(newValue);
  
  if (old.isZero()) {
    return toDecimal(0);
  }
  
  return current.minus(old).div(old);
}

/**
 * 计算年化收益率
 */
export function annualizedReturn(
  rate: Decimal | string | number,
  intervalHours: number
): Decimal {
  const r = toDecimal(rate);
  const dailySettlements = 24 / intervalHours;
  return r.mul(dailySettlements).mul(365);
}

/**
 * 格式化为固定小数位数
 */
export function formatDecimal(
  value: Decimal | string | number,
  decimals: number = 8
): string {
  return toDecimal(value).toFixed(decimals);
}

/**
 * 格式化为百分比
 */
export function formatPercent(
  value: Decimal | string | number,
  decimals: number = 2
): string {
  return `${toDecimal(value).mul(100).toFixed(decimals)}%`;
}

/**
 * 格式化为货币
 */
export function formatCurrency(
  value: Decimal | string | number,
  currency: string = 'USDT',
  decimals: number = 2
): string {
  return `${toDecimal(value).toFixed(decimals)} ${currency}`;
}

/**
 * 比较两个数值
 */
export function compare(
  a: Decimal | string | number,
  b: Decimal | string | number
): -1 | 0 | 1 {
  return toDecimal(a).cmp(toDecimal(b)) as -1 | 0 | 1;
}

/**
 * 检查是否在范围内
 */
export function isInRange(
  value: Decimal | string | number,
  min: Decimal | string | number,
  max: Decimal | string | number
): boolean {
  const v = toDecimal(value);
  return v.gte(toDecimal(min)) && v.lte(toDecimal(max));
}

/**
 * 计算多个数值的总和
 */
export function sum(...values: Array<Decimal | string | number>): Decimal {
  return values.reduce<Decimal>(
    (acc, val) => acc.plus(toDecimal(val)),
    toDecimal(0) as Decimal
  );
}

/**
 * 计算多个数值的平均值
 */
export function average(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) {
    return toDecimal(0);
  }
  return sum(...values).div(values.length);
}

/**
 * 取最小值
 */
export function min(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) {
    throw new Error('min() requires at least one argument');
  }
  return values.reduce<Decimal>((minVal, val) => {
    const v = toDecimal(val) as Decimal;
    return v.lt(minVal) ? v : minVal;
  }, toDecimal(values[0]!) as Decimal);
}

/**
 * 取最大值
 */
export function max(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) {
    throw new Error('max() requires at least one argument');
  }
  return values.reduce<Decimal>((maxVal, val) => {
    const v = toDecimal(val) as Decimal;
    return v.gt(maxVal) ? v : maxVal;
  }, toDecimal(values[0]!) as Decimal);
}

/**
 * 取两个值的最小值
 */
export function decimalMin(a: Decimal | string | number, b: Decimal | string | number): Decimal {
  const da = toDecimal(a);
  const db = toDecimal(b);
  return da.lt(db) ? da : db;
}

/**
 * 取两个值的最大值
 */
export function decimalMax(a: Decimal | string | number, b: Decimal | string | number): Decimal {
  const da = toDecimal(a);
  const db = toDecimal(b);
  return da.gt(db) ? da : db;
}

/**
 * 将数值限制在范围内
 */
export function clamp(
  value: Decimal | string | number,
  minVal: Decimal | string | number,
  maxVal: Decimal | string | number
): Decimal {
  const v = toDecimal(value);
  const minD = toDecimal(minVal);
  const maxD = toDecimal(maxVal);
  
  if (v.lt(minD)) return minD;
  if (v.gt(maxD)) return maxD;
  return v;
}

/**
 * 根据精度调整数量
 */
export function adjustQuantity(
  quantity: Decimal | string | number,
  stepSize: Decimal | string | number
): Decimal {
  const qty = toDecimal(quantity);
  const step = toDecimal(stepSize);
  
  if (step.isZero()) {
    return qty;
  }
  
  return qty.div(step).floor().mul(step);
}

/**
 * 根据精度调整价格
 */
export function adjustPrice(
  price: Decimal | string | number,
  tickSize: Decimal | string | number
): Decimal {
  const p = toDecimal(price);
  const tick = toDecimal(tickSize);
  
  if (tick.isZero()) {
    return p;
  }
  
  return p.div(tick).floor().mul(tick);
}
