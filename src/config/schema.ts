/**
 * 配置校验 Schema
 * 使用 Zod 定义类型安全的配置结构
 */

import { z } from 'zod';

// ===========================================
// 交易所配置
// ===========================================

export const rateLimitSchema = z.object({
  maxRequestsPerMinute: z.number().min(1).max(2400).default(1200),
  maxOrdersPerSecond: z.number().min(1).max(100).default(10),
  burstLimit: z.number().min(1).max(200).default(50),
  retryDelay: z.number().min(100).max(60000).default(1000),
});

export const exchangeSchema = z.object({
  name: z.enum(['binance', 'okx', 'bybit']).default('binance'),
  testnet: z.boolean().default(true),
  rateLimit: rateLimitSchema.default({}),
});

// ===========================================
// 策略配置
// ===========================================

export const scannerSchema = z.object({
  minAnnualizedReturn: z.number().min(0).max(10).default(0.30),
  min24hVolume: z.number().min(0).default(1000000),
  maxSpreadPct: z.number().min(0).max(0.1).default(0.005),
  stabilityWindowHours: z.number().min(1).max(168).default(72),
  minPositiveRatio: z.number().min(0).max(1).default(0.6),
  scanIntervalSeconds: z.number().min(60).max(3600).default(600),
});

export const settlementWindowSchema = z.object({
  blackoutBeforeMinutes: z.number().min(0).max(30).default(5),
  blackoutAfterMinutes: z.number().min(0).max(30).default(2),
});

export const signalsSchema = z.object({
  openAnnualizedThreshold: z.number().min(0).max(10).default(0.30),
  closeAnnualizedThreshold: z.number().min(0).max(10).default(0.10),
  cooldownHours: z.number().min(0).max(168).default(24),
  settlementWindow: settlementWindowSchema.default({}),
});

export const riskSchema = z.object({
  // 仓位管理
  maxPositionPct: z.number().min(0.01).max(1).default(0.15),
  maxTotalExposurePct: z.number().min(0.01).max(1).default(0.70),
  maxPositions: z.number().min(1).max(20).default(5),
  minPositionValue: z.number().min(1).default(100),
  
  // 止损止盈
  spreadStopLossPct: z.number().min(0).max(0.1).default(0.008),
  combinedStopLossPct: z.number().min(0).max(0.2).default(0.02),
  takeProfitFundingPct: z.number().min(0).max(0.5).default(0.03),
  maxHoldingDays: z.number().min(1).max(365).default(14),
  
  // 账户级别风控
  maxDrawdownPct: z.number().min(0).max(1).default(0.10),
  emergencyStopLoss: z.number().min(0).max(1).default(0.15),
  
  // 合约保证金
  targetLeverage: z.number().min(1).max(10).default(2),
  maxLeverage: z.number().min(1).max(20).default(3),
  marginCallThreshold: z.number().min(0.01).max(0.5).default(0.15),
});

export const executionSchema = z.object({
  legTimeoutSeconds: z.number().min(1).max(120).default(10),
  totalTimeoutSeconds: z.number().min(1).max(300).default(30),
  maxSlippagePct: z.number().min(0).max(0.05).default(0.001),
  quantityTolerancePct: z.number().min(0).max(0.1).default(0.02),
  useLimitOrders: z.boolean().default(true),
  maxConcurrentOrders: z.number().min(1).max(10).default(2),
  orderInterval: z.number().min(100).max(10000).default(1000),
});

export const strategySchema = z.object({
  scanner: scannerSchema.default({}),
  signals: signalsSchema.default({}),
  risk: riskSchema.default({}),
  execution: executionSchema.default({}),
});

// ===========================================
// 资金划转配置
// ===========================================

export const transferSchema = z.object({
  autoTransfer: z.boolean().default(true),
  minTransferAmount: z.number().min(1).default(10),
  reserveInSpot: z.number().min(0).default(100),
  reserveInFutures: z.number().min(0).default(100),
});

// ===========================================
// 回测配置
// ===========================================

export const commissionSchema = z.object({
  spotMaker: z.number().min(0).max(0.01).default(0.001),
  spotTaker: z.number().min(0).max(0.01).default(0.001),
  futuresMaker: z.number().min(0).max(0.01).default(0.0002),
  futuresTaker: z.number().min(0).max(0.01).default(0.0004),
  useBnbDiscount: z.boolean().default(false),
});

export const volumeBasedSlippageSchema = z.object({
  baseSlippage: z.number().min(0).max(0.01).default(0.0002),
  volumeMultiplier: z.number().min(0).max(0.001).default(0.00001),
});

export const slippageSchema = z.object({
  model: z.enum(['FIXED', 'VOLUME_BASED', 'ORDERBOOK_BASED']).default('VOLUME_BASED'),
  fixedPct: z.number().min(0).max(0.01).optional(),
  volumeBased: volumeBasedSlippageSchema.optional(),
});

export const backtestSchema = z.object({
  defaultPeriodDays: z.number().min(1).max(365).default(30),
  initialCapital: z.number().min(100).default(10000),
  commission: commissionSchema.default({}),
  slippage: slippageSchema.default({}),
});

// ===========================================
// 监控配置
// ===========================================

export const alertLevelsSchema = z.object({
  critical: z.boolean().default(true),
  error: z.boolean().default(true),
  warning: z.boolean().default(true),
  info: z.boolean().default(false),
});

export const alertsSchema = z.object({
  enabled: z.boolean().default(true),
  levels: alertLevelsSchema.default({}),
});

export const monitoringSchema = z.object({
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  metricsEnabled: z.boolean().default(true),
  alerts: alertsSchema.default({}),
});

// ===========================================
// API 配置
// ===========================================

export const corsSchema = z.object({
  enabled: z.boolean().default(true),
  origin: z.string().default('*'),
});

export const apiSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  cors: corsSchema.default({}),
});

// ===========================================
// 完整配置 Schema
// ===========================================

export const configSchema = z.object({
  exchange: exchangeSchema.default({}),
  strategy: strategySchema.default({}),
  transfer: transferSchema.default({}),
  backtest: backtestSchema.default({}),
  monitoring: monitoringSchema.default({}),
  api: apiSchema.default({}),
});

// 导出类型
export type Config = z.infer<typeof configSchema>;
export type ExchangeConfig = z.infer<typeof exchangeSchema>;
export type StrategyConfig = z.infer<typeof strategySchema>;
export type ScannerConfig = z.infer<typeof scannerSchema>;
export type SignalsConfig = z.infer<typeof signalsSchema>;
export type RiskConfig = z.infer<typeof riskSchema>;
export type ExecutionConfig = z.infer<typeof executionSchema>;
export type TransferConfig = z.infer<typeof transferSchema>;
export type BacktestConfig = z.infer<typeof backtestSchema>;
export type MonitoringConfig = z.infer<typeof monitoringSchema>;
export type ApiConfig = z.infer<typeof apiSchema>;
