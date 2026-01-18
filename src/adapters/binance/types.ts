/**
 * 币安 API 类型定义
 */

// ===========================================
// 基础类型
// ===========================================

export interface BinanceApiConfig {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;
  params?: Record<string, string | number | boolean | undefined>;
  signed?: boolean;
  marketType: 'spot' | 'futures';
}

// ===========================================
// 现货 API 响应类型
// ===========================================

export interface SpotAccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  accountType: string;
  balances: SpotBalance[];
}

export interface SpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface SpotOrderResponse {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  fills?: SpotOrderFill[];
}

export interface SpotOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId: number;
}

export interface SpotOrderQueryResponse {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce: string;
  type: string;
  side: string;
  stopPrice: string;
  icebergQty: string;
  time: number;
  updateTime: number;
  isWorking: boolean;
  origQuoteOrderQty: string;
}

export interface SpotTickerPrice {
  symbol: string;
  price: string;
}

export interface SpotBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

export interface SpotDepth {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][];
}

export interface Spot24hTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface SpotExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: RateLimit[];
  symbols: SpotSymbolInfo[];
}

export interface SpotSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: SymbolFilter[];
}

// ===========================================
// 合约 API 响应类型
// ===========================================

export interface FuturesAccountInfo {
  feeTier: number;
  canTrade: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  updateTime: number;
  totalInitialMargin: string;
  totalMaintMargin: string;
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  totalPositionInitialMargin: string;
  totalOpenOrderInitialMargin: string;
  totalCrossWalletBalance: string;
  totalCrossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  assets: FuturesAsset[];
  positions: FuturesPositionInfo[];
}

export interface FuturesAsset {
  asset: string;
  walletBalance: string;
  unrealizedProfit: string;
  marginBalance: string;
  maintMargin: string;
  initialMargin: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  crossWalletBalance: string;
  crossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

export interface FuturesPositionInfo {
  symbol: string;
  initialMargin: string;
  maintMargin: string;
  unrealizedProfit: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  leverage: string;
  isolated: boolean;
  entryPrice: string;
  maxNotional: string;
  positionSide: string;
  positionAmt: string;
  notional: string;
  isolatedWallet: string;
  updateTime: number;
  bidNotional: string;
  askNotional: string;
}

export interface FuturesPositionRisk {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  maxNotionalValue: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  notional: string;
  isolatedWallet: string;
  updateTime: number;
}

export interface FuturesOrderResponse {
  orderId: number;
  symbol: string;
  status: string;
  clientOrderId: string;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  cumQuote: string;
  timeInForce: string;
  type: string;
  reduceOnly: boolean;
  closePosition: boolean;
  side: string;
  positionSide: string;
  stopPrice: string;
  workingType: string;
  priceProtect: boolean;
  origType: string;
  updateTime: number;
}

export interface FuturesOrderQueryResponse extends FuturesOrderResponse {
  time: number;
}

export interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  time: number;
}

export interface FundingRateResponse {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

export interface FuturesDepth {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface Futures24hTicker {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface FuturesExchangeInfo {
  timezone: string;
  serverTime: number;
  futuresType: string;
  rateLimits: RateLimit[];
  exchangeFilters: unknown[];
  assets: FuturesAssetInfo[];
  symbols: FuturesSymbolInfo[];
}

export interface FuturesAssetInfo {
  asset: string;
  marginAvailable: boolean;
  autoAssetExchange: string;
}

export interface FuturesSymbolInfo {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  onboardDate: number;
  status: string;
  maintMarginPercent: string;
  requiredMarginPercent: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quotePrecision: number;
  underlyingType: string;
  underlyingSubType: string[];
  settlePlan: number;
  triggerProtect: string;
  liquidationFee: string;
  marketTakeBound: string;
  filters: SymbolFilter[];
  orderTypes: string[];
  timeInForce: string[];
}

// ===========================================
// 通用类型
// ===========================================

export interface RateLimit {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
}

export interface SymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  notional?: string;
  minNotional?: string;
  limit?: number;
  maxNumOrders?: number;
  maxNumAlgoOrders?: number;
  multiplierUp?: string;
  multiplierDown?: string;
  avgPriceMins?: number;
}

export interface TransferResponse {
  tranId: number;
}

// ===========================================
// WebSocket 消息类型
// ===========================================

export interface WsBookTicker {
  e: string; // Event type
  u: number; // Update ID
  s: string; // Symbol
  b: string; // Best bid price
  B: string; // Best bid quantity
  a: string; // Best ask price
  A: string; // Best ask quantity
}

export interface WsMarkPrice {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  p: string; // Mark price
  i: string; // Index price
  P: string; // Estimated Settle Price
  r: string; // Funding rate
  T: number; // Next funding time
}

export interface WsUserDataUpdate {
  e: string; // Event type
  E: number; // Event time
  // ORDER_TRADE_UPDATE
  o?: {
    s: string; // Symbol
    c: string; // Client Order Id
    S: string; // Side
    o: string; // Order Type
    f: string; // Time in Force
    q: string; // Original Quantity
    p: string; // Original Price
    ap: string; // Average Price
    sp: string; // Stop Price
    x: string; // Execution Type
    X: string; // Order Status
    i: number; // Order Id
    l: string; // Order Last Filled Quantity
    z: string; // Order Filled Accumulated Quantity
    L: string; // Last Filled Price
    N: string; // Commission Asset
    n: string; // Commission
    T: number; // Order Trade Time
    t: number; // Trade Id
    rp: string; // Realized Profit
    ps: string; // Position Side
  };
  // ACCOUNT_UPDATE
  a?: {
    m: string; // Event reason type
    B: Array<{
      a: string; // Asset
      wb: string; // Wallet Balance
      cw: string; // Cross Wallet Balance
      bc: string; // Balance Change except PnL and Commission
    }>;
    P: Array<{
      s: string; // Symbol
      pa: string; // Position Amount
      ep: string; // Entry Price
      cr: string; // Accumulated Realized
      up: string; // Unrealized PnL
      mt: string; // Margin Type
      iw: string; // Isolated Wallet
      ps: string; // Position Side
    }>;
  };
}

// ===========================================
// 错误类型
// ===========================================

export interface BinanceApiError {
  code: number;
  msg: string;
}

export class BinanceError extends Error {
  code: number;
  
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'BinanceError';
  }
}

// 常见错误码
export const ErrorCodes = {
  UNKNOWN: -1000,
  DISCONNECTED: -1001,
  UNAUTHORIZED: -1002,
  TOO_MANY_REQUESTS: -1003,
  SERVER_BUSY: -1004,
  UNEXPECTED_RESP: -1006,
  TIMEOUT: -1007,
  INVALID_MESSAGE: -1013,
  UNKNOWN_ORDER_COMPOSITION: -1014,
  TOO_MANY_ORDERS: -1015,
  SERVICE_SHUTTING_DOWN: -1016,
  UNSUPPORTED_OPERATION: -1020,
  INVALID_TIMESTAMP: -1021,
  INVALID_SIGNATURE: -1022,
  ILLEGAL_CHARS: -1100,
  TOO_MANY_PARAMETERS: -1101,
  MANDATORY_PARAM_EMPTY: -1102,
  UNKNOWN_PARAM: -1103,
  UNREAD_PARAMETERS: -1104,
  PARAM_EMPTY: -1105,
  PARAM_NOT_REQUIRED: -1106,
  NO_DEPTH: -1112,
  TIF_NOT_REQUIRED: -1114,
  INVALID_TIF: -1115,
  INVALID_ORDER_TYPE: -1116,
  INVALID_SIDE: -1117,
  EMPTY_NEW_CL_ORD_ID: -1118,
  EMPTY_ORG_CL_ORD_ID: -1119,
  BAD_INTERVAL: -1120,
  BAD_SYMBOL: -1121,
  INVALID_LISTEN_KEY: -1125,
  MORE_THAN_XX_HOURS: -1127,
  OPTIONAL_PARAMS_BAD_COMBO: -1128,
  INVALID_PARAMETER: -1130,
  NEW_ORDER_REJECTED: -2010,
  CANCEL_REJECTED: -2011,
  NO_SUCH_ORDER: -2013,
  BAD_API_KEY_FMT: -2014,
  REJECTED_MBX_KEY: -2015,
  NO_TRADING_WINDOW: -2016,
  BALANCE_NOT_SUFFICIENT: -2019,
  MARGIN_NOT_SUFFICIENT: -4028,
  POSITION_NOT_SUFFICIENT: -2022,
} as const;
