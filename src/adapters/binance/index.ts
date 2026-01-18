/**
 * 币安交易所适配器
 * 
 * 统一封装现货和合约 API
 */

import { logger } from '../../utils/logger.js';
import { Decimal, toDecimal } from '../../utils/decimal.js';
import { BinanceRestClient, BinanceWebSocket } from './client.js';
import { SpotApi } from './spot.js';
import { FuturesApi } from './futures.js';
import { BinanceApiConfig, WsMarkPrice } from './types.js';
import {
  ExchangeType,
  MarketType,
  Balance,
  Order,
  OrderBook,
  FundingRateInfo,
  FuturesPosition,
  OrderParams,
} from '../../types/index.js';

export interface BinanceAdapterConfig extends BinanceApiConfig {}

/**
 * 币安适配器
 * 
 * 实现统一的交易所接口，供策略模块调用
 */
export class BinanceAdapter {
  readonly exchangeType = ExchangeType.BINANCE;
  
  private readonly client: BinanceRestClient;
  private readonly spotApi: SpotApi;
  private readonly futuresApi: FuturesApi;
  private wsSpot: BinanceWebSocket | null = null;
  private wsFutures: BinanceWebSocket | null = null;
  private readonly testnet: boolean;
  
  /** 现货市场支持的交易对缓存 */
  private spotSymbols: Set<string> = new Set();
  private spotSymbolsLoaded = false;

  constructor(config: BinanceAdapterConfig) {
    this.client = new BinanceRestClient(config);
    this.spotApi = new SpotApi(this.client);
    this.futuresApi = new FuturesApi(this.client);
    this.testnet = config.testnet ?? false;
  }
  
  /**
   * 加载现货交易对列表
   */
  async loadSpotSymbols(): Promise<void> {
    if (this.spotSymbolsLoaded) return;
    
    try {
      const info = await this.spotApi.getExchangeInfo();
      this.spotSymbols = new Set(info.symbols.map(s => s.symbol));
      this.spotSymbolsLoaded = true;
      logger.info({ count: this.spotSymbols.size }, '已加载现货交易对列表');
    } catch (error) {
      logger.warn({ error }, '加载现货交易对列表失败');
    }
  }
  
  /**
   * 检查现货交易对是否存在
   */
  hasSpotSymbol(symbol: string): boolean {
    return this.spotSymbols.has(symbol);
  }

  // ===========================================
  // 连接管理
  // ===========================================

  /**
   * 同步服务器时间
   */
  async syncTime(): Promise<void> {
    await this.client.syncServerTime();
  }

  /**
   * 检查 API 连接
   */
  async checkConnection(): Promise<boolean> {
    try {
      await this.spotApi.getExchangeInfo();
      await this.futuresApi.getExchangeInfo();
      return true;
    } catch (error) {
      logger.error({ error }, 'API 连接检查失败');
      return false;
    }
  }

  /**
   * 连接 WebSocket
   */
  async connectWebSocket(): Promise<void> {
    // 连接合约 WebSocket（主要用于监控费率）
    this.wsFutures = new BinanceWebSocket(this.testnet, 'futures');
    await this.wsFutures.connect(['!markPrice@arr@1s']);
    logger.info('合约 WebSocket 已连接');
  }

  /**
   * 断开 WebSocket
   */
  disconnectWebSocket(): void {
    if (this.wsSpot) {
      this.wsSpot.close();
      this.wsSpot = null;
    }
    if (this.wsFutures) {
      this.wsFutures.close();
      this.wsFutures = null;
    }
    logger.info('WebSocket 已断开');
  }

  /**
   * 检查 WebSocket 连接状态
   */
  isWsConnected(): boolean {
    return this.wsFutures?.isConnected() ?? false;
  }

  // ===========================================
  // 市场数据
  // ===========================================

  /**
   * 获取资金费率
   */
  async getFundingRates(symbols?: string[]): Promise<FundingRateInfo[]> {
    return this.futuresApi.getFundingRates(symbols);
  }

  /**
   * 获取历史资金费率
   */
  async getFundingRateHistory(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<FundingRateInfo[]> {
    const history = await this.futuresApi.getFundingRateHistory(symbol, startTime, endTime);
    
    return history.map((h) => ({
      symbol: h.symbol,
      fundingRate: toDecimal(h.fundingRate),
      fundingInterval: 8, // 历史数据默认 8h
      nextFundingTime: new Date(h.fundingTime),
      markPrice: toDecimal(0),
      indexPrice: toDecimal(0),
      timestamp: new Date(h.fundingTime),
    }));
  }

  /**
   * 获取订单簿
   */
  async getOrderBook(symbol: string, marketType: MarketType): Promise<OrderBook> {
    if (marketType === MarketType.SPOT) {
      // 先检查现货交易对是否存在
      if (this.spotSymbolsLoaded && !this.spotSymbols.has(symbol)) {
        logger.debug({ symbol }, '现货交易对不存在，返回空订单簿');
        return {
          symbol,
          bids: [],
          asks: [],
          timestamp: new Date(),
        };
      }
      return this.spotApi.getDepth(symbol);
    }
    return this.futuresApi.getDepth(symbol);
  }

  /**
   * 获取 24 小时成交量
   */
  async get24hVolume(symbol: string, marketType: MarketType): Promise<Decimal> {
    if (marketType === MarketType.SPOT) {
      // 先检查现货交易对是否存在
      if (this.spotSymbolsLoaded && !this.spotSymbols.has(symbol)) {
        logger.debug({ symbol }, '现货交易对不存在，跳过');
        return toDecimal(0);
      }
      return this.spotApi.get24hVolume(symbol);
    }
    return this.futuresApi.get24hVolume(symbol);
  }

  /**
   * 获取最优买卖价
   */
  async getBestPrices(symbol: string): Promise<{ bid: Decimal; ask: Decimal }> {
    const ticker = await this.spotApi.getBookTicker(symbol);
    return {
      bid: toDecimal(ticker.bidPrice),
      ask: toDecimal(ticker.askPrice),
    };
  }

  // ===========================================
  // 交易操作
  // ===========================================

  /**
   * 下单
   */
  async placeOrder(params: OrderParams): Promise<Order> {
    if (params.marketType === MarketType.SPOT) {
      return this.spotApi.placeOrder({
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        quantity: params.quantity,
        price: params.price,
        clientOrderId: params.clientOrderId,
      });
    }
    
    return this.futuresApi.placeOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      positionSide: params.positionSide,
      reduceOnly: params.reduceOnly,
      clientOrderId: params.clientOrderId,
    });
  }

  /**
   * 取消订单
   */
  async cancelOrder(
    orderId: string,
    symbol: string,
    marketType: MarketType
  ): Promise<boolean> {
    const numericOrderId = parseInt(orderId, 10);
    
    if (marketType === MarketType.SPOT) {
      return this.spotApi.cancelOrder(symbol, numericOrderId);
    }
    return this.futuresApi.cancelOrder(symbol, numericOrderId);
  }

  /**
   * 获取订单状态
   */
  async getOrderStatus(
    orderId: string,
    symbol: string,
    marketType: MarketType
  ): Promise<Order> {
    const numericOrderId = parseInt(orderId, 10);
    
    if (marketType === MarketType.SPOT) {
      return this.spotApi.getOrder(symbol, numericOrderId);
    }
    return this.futuresApi.getOrder(symbol, numericOrderId);
  }

  // ===========================================
  // 账户信息
  // ===========================================

  /**
   * 获取现货余额
   */
  async getSpotBalances(): Promise<Balance[]> {
    return this.spotApi.getBalances();
  }

  /**
   * 获取合约余额
   */
  async getFuturesBalances(): Promise<Balance[]> {
    return this.futuresApi.getBalances();
  }

  /**
   * 获取所有余额
   */
  async getBalances(): Promise<{ spot: Balance[]; futures: Balance[] }> {
    const [spot, futures] = await Promise.all([
      this.spotApi.getBalances(),
      this.futuresApi.getBalances(),
    ]);
    return { spot, futures };
  }

  /**
   * 获取合约持仓
   */
  async getPositions(symbols?: string[]): Promise<FuturesPosition[]> {
    return this.futuresApi.getPositions(symbols);
  }

  /**
   * 获取合约总权益
   */
  async getFuturesTotalEquity(): Promise<Decimal> {
    return this.futuresApi.getTotalEquity();
  }

  /**
   * 获取可用余额
   */
  async getAvailableBalance(): Promise<{ spot: Decimal; futures: Decimal }> {
    const [spotBalance, futuresBalance] = await Promise.all([
      this.spotApi.getBalance('USDT'),
      this.futuresApi.getAvailableBalance(),
    ]);
    
    return {
      spot: spotBalance?.free ?? toDecimal(0),
      futures: futuresBalance,
    };
  }

  // ===========================================
  // 合约特有操作
  // ===========================================

  /**
   * 设置杠杆
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.futuresApi.setLeverage(symbol, leverage);
  }

  /**
   * 设置保证金模式
   */
  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    await this.futuresApi.setMarginType(symbol, marginType);
  }

  /**
   * 资金划转：现货 -> 合约
   */
  async transferToFutures(amount: Decimal, asset: string = 'USDT'): Promise<number> {
    return this.futuresApi.transferFromSpot(amount, asset);
  }

  /**
   * 资金划转：合约 -> 现货
   */
  async transferToSpot(amount: Decimal, asset: string = 'USDT'): Promise<number> {
    return this.futuresApi.transferToSpot(amount, asset);
  }

  // ===========================================
  // 便捷交易方法
  // ===========================================

  /**
   * 现货市价买入
   */
  async spotBuy(symbol: string, quantity: Decimal): Promise<Order> {
    return this.spotApi.marketBuy(symbol, quantity);
  }

  /**
   * 现货市价卖出
   */
  async spotSell(symbol: string, quantity: Decimal): Promise<Order> {
    return this.spotApi.marketSell(symbol, quantity);
  }

  /**
   * 现货限价买入
   */
  async spotLimitBuy(symbol: string, quantity: Decimal, price: Decimal): Promise<Order> {
    return this.spotApi.limitBuy(symbol, quantity, price);
  }

  /**
   * 现货限价卖出
   */
  async spotLimitSell(symbol: string, quantity: Decimal, price: Decimal): Promise<Order> {
    return this.spotApi.limitSell(symbol, quantity, price);
  }

  /**
   * 合约开空
   */
  async futuresOpenShort(symbol: string, quantity: Decimal): Promise<Order> {
    return this.futuresApi.openShort(symbol, quantity);
  }

  /**
   * 合约平空
   */
  async futuresCloseShort(symbol: string, quantity: Decimal): Promise<Order> {
    return this.futuresApi.closeShort(symbol, quantity);
  }

  /**
   * 合约限价开空
   */
  async futuresLimitOpenShort(
    symbol: string,
    quantity: Decimal,
    price: Decimal
  ): Promise<Order> {
    return this.futuresApi.limitOpenShort(symbol, quantity, price);
  }

  /**
   * 合约限价平空
   */
  async futuresLimitCloseShort(
    symbol: string,
    quantity: Decimal,
    price: Decimal
  ): Promise<Order> {
    return this.futuresApi.limitCloseShort(symbol, quantity, price);
  }

  // ===========================================
  // WebSocket 订阅
  // ===========================================

  /**
   * 订阅资金费率更新
   */
  subscribeFundingRate(callback: (data: FundingRateInfo) => void): () => void {
    if (!this.wsFutures) {
      throw new Error('WebSocket 未连接');
    }

    return this.wsFutures.subscribe('markPriceUpdate', (raw) => {
      const data = raw as WsMarkPrice;
      callback({
        symbol: data.s,
        fundingRate: toDecimal(data.r),
        fundingInterval: 8, // WebSocket 不提供周期信息，默认 8h
        nextFundingTime: new Date(data.T),
        markPrice: toDecimal(data.p),
        indexPrice: toDecimal(data.i),
        timestamp: new Date(data.E),
      });
    });
  }

  /**
   * 获取原始 API 客户端（用于高级操作）
   */
  getRawClients(): { spot: SpotApi; futures: FuturesApi } {
    return {
      spot: this.spotApi,
      futures: this.futuresApi,
    };
  }
}

// 重新导出类型
export * from './types.js';
