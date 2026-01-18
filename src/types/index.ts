/**
 * 现期费率套利系统 - 核心类型定义
 */

// Decimal 类型 - 使用 any 以避免与 decimal.js 的类型兼容性问题
// 在运行时，这些是 decimal.js 的实例
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Decimal = any;

// ===========================================
// 交易所相关类型
// ===========================================

/** 交易所类型 */
export enum ExchangeType {
  BINANCE = 'binance',
  OKX = 'okx',
  BYBIT = 'bybit',
}

/** 市场类型 */
export enum MarketType {
  SPOT = 'spot',
  FUTURES = 'futures',
  SWAP = 'swap',
}

/** 订单方向 */
export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

/** 订单类型 */
export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
}

/** 订单状态 */
export enum OrderStatus {
  NEW = 'NEW',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELED = 'CANCELED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

/** 持仓方向 */
export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
  BOTH = 'BOTH',
}

// ===========================================
// 资金费率相关类型
// ===========================================

/** 资金费率信息 */
export interface FundingRateInfo {
  symbol: string;
  fundingRate: Decimal;
  fundingInterval: number; // 结算周期（小时）：1 | 4 | 8
  nextFundingTime: Date;
  markPrice: Decimal;
  indexPrice: Decimal;
  timestamp: Date;
}

/** 费率结算记录 */
export interface FundingRecord {
  id: string;
  positionId: string;
  symbol: string;
  fundingRate: number;
  fundingInterval: number;
  annualizedRate: number;
  scheduledTime: Date;
  settledAt: Date;
  markPriceAtSettlement: number;
  positionSize: number;
  positionValueAtSettlement: number;
  fundingAmount: number;
  isEstimated: boolean;
  createdAt: Date;
}

// ===========================================
// 订单相关类型
// ===========================================

/** 订单参数 */
export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: Decimal;
  price?: Decimal;
  marketType: MarketType;
  positionSide?: PositionSide;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

/** 订单信息 */
export interface Order {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: Decimal;
  quantity: Decimal;
  executedQty: Decimal;
  avgPrice: Decimal;
  marketType: MarketType;
  createdAt: Date;
  updatedAt: Date;
}

/** 订单簿 */
export interface OrderBook {
  symbol: string;
  bids: Array<[Decimal, Decimal]>; // [price, quantity]
  asks: Array<[Decimal, Decimal]>;
  timestamp: Date;
}

// ===========================================
// 持仓相关类型
// ===========================================

/** 套利持仓状态 */
export enum ArbitragePositionStatus {
  OPENING = 'OPENING',
  ACTIVE = 'ACTIVE',
  CLOSING = 'CLOSING',
  CLOSED = 'CLOSED',
  ERROR = 'ERROR',
}

/** 套利持仓 */
export interface ArbitragePosition {
  id: string;
  symbol: string;
  status: ArbitragePositionStatus;
  
  // 现货端
  spotQuantity: Decimal;
  spotEntryPrice: Decimal;
  spotExitPrice?: Decimal;
  spotOrderId?: string;
  
  // 合约端
  futuresQuantity: Decimal;
  futuresEntryPrice: Decimal;
  futuresExitPrice?: Decimal;
  futuresOrderId?: string;
  
  // 费率相关
  fundingInterval: number;
  totalFundingCollected: Decimal;
  fundingRecordCount: number;
  
  // 盈亏
  unrealizedPnL: Decimal;
  realizedPnL?: Decimal;
  
  // 时间戳
  openedAt: Date;
  closedAt?: Date;
  lastUpdatedAt: Date;
  
  // 元数据
  closeReason?: string;
  metadata?: Record<string, unknown>;
}

/** 合约持仓信息 */
export interface FuturesPosition {
  symbol: string;
  positionSide: PositionSide;
  positionAmt: Decimal;
  entryPrice: Decimal;
  markPrice: Decimal;
  unrealizedProfit: Decimal;
  liquidationPrice: Decimal;
  leverage: number;
  marginType: 'isolated' | 'cross';
  isolatedMargin: Decimal;
  notional: Decimal;
  updateTime: Date;
}

// ===========================================
// 账户相关类型
// ===========================================

/** 账户余额 */
export interface Balance {
  asset: string;
  free: Decimal;
  locked: Decimal;
  total: Decimal;
}

/** 账户信息 */
export interface AccountInfo {
  balances: Balance[];
  totalEquity: Decimal;
  availableBalance: Decimal;
  marginBalance?: Decimal;
  unrealizedPnL?: Decimal;
}

// ===========================================
// 交易信号相关类型
// ===========================================

/** 信号类型 */
export enum SignalType {
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
  ADJUST = 'ADJUST',
}

/** 平仓原因 */
export enum CloseReason {
  STOP_LOSS = 'STOP_LOSS',
  SPREAD_STOP_LOSS = 'SPREAD_STOP_LOSS',
  MARGIN_CALL = 'MARGIN_CALL',
  TAKE_PROFIT = 'TAKE_PROFIT',
  FUNDING_DECLINE = 'FUNDING_DECLINE',
  HOLDING_TIMEOUT = 'HOLDING_TIMEOUT',
  MANUAL = 'MANUAL',
  EMERGENCY = 'EMERGENCY',
}

/** 交易信号 */
export interface Signal {
  id: string;
  type: SignalType;
  symbol: string;
  timestamp: Date;
  
  // 开仓信号特有
  annualizedReturn?: number;
  fundingRate?: number;
  fundingInterval?: number;
  
  // 平仓信号特有
  closeReason?: CloseReason;
  positionId?: string;
  
  // 通用
  priority: number;
  metadata?: Record<string, unknown>;
}

/** 套利机会 */
export interface Opportunity {
  id: string;
  symbol: string;
  fundingRate: Decimal;
  fundingInterval: number;
  annualizedReturn: Decimal;
  volume24h: Decimal;
  spreadPct: Decimal;
  stabilityScore: number;
  liquidityScore: number;
  overallScore: number;
  timestamp: Date;
}

// ===========================================
// 回测相关类型
// ===========================================

/** 回测配置 */
export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols?: string[];
  commission: {
    spotMaker: number;
    spotTaker: number;
    futuresMaker: number;
    futuresTaker: number;
    useBnbDiscount: boolean;
  };
  slippage: {
    model: 'FIXED' | 'VOLUME_BASED' | 'ORDERBOOK_BASED';
    fixedPct?: number;
    volumeBased?: {
      baseSlippage: number;
      volumeMultiplier: number;
    };
  };
}

/** 回测结果 */
export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  
  // 核心指标
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  
  // 策略特有指标
  totalFundingCollected: number;
  avgHoldingPeriodDays: number;
  capitalUtilization: number;
  fundingIncomeRatio: number;
  spreadLoss: number;
  
  // 交易统计
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgTradeReturn: number;
  
  // 资金曲线
  equityCurve: Array<{ date: Date; equity: number }>;
  
  // 执行时间
  executedAt: Date;
  durationMs: number;
}

// ===========================================
// 告警相关类型
// ===========================================

/** 告警级别 */
export enum AlertLevel {
  CRITICAL = 'CRITICAL',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

/** 告警消息 */
export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

// ===========================================
// 系统状态类型
// ===========================================

/** 系统状态 */
export interface SystemStatus {
  isRunning: boolean;
  startedAt?: Date;
  uptime: number;
  apiConnected: boolean;
  wsConnected: boolean;
  dbConnected: boolean;
  activePositions: number;
  totalEquity: Decimal;
  unrealizedPnL: Decimal;
  lastScanAt?: Date;
  lastError?: string;
}
