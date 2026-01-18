/**
 * 币安合约 API 封装 (USDT 永续合约)
 */

import { Decimal, toDecimal } from '../../utils/decimal.js';
import { BinanceRestClient } from './client.js';
import {
  FuturesAccountInfo,
  FuturesPositionRisk,
  FuturesOrderResponse,
  FuturesOrderQueryResponse,
  FuturesDepth,
  Futures24hTicker,
  FuturesExchangeInfo,
  PremiumIndex,
  FundingRateResponse,
  TransferResponse,
} from './types.js';
import {
  Balance,
  Order,
  OrderBook,
  OrderSide,
  OrderStatus,
  OrderType,
  MarketType,
  FuturesPosition,
  PositionSide,
  FundingRateInfo,
} from '../../types/index.js';

/**
 * 合约 API 客户端
 */
export class FuturesApi {
  constructor(private readonly client: BinanceRestClient) {}

  // ===========================================
  // 市场数据
  // ===========================================

  /**
   * 获取交易所信息
   */
  async getExchangeInfo(): Promise<FuturesExchangeInfo> {
    return this.client.get<FuturesExchangeInfo>('/fapi/v1/exchangeInfo', {}, 'futures');
  }

  /**
   * 获取溢价指数（包含资金费率）
   */
  async getPremiumIndex(symbol?: string): Promise<PremiumIndex[]> {
    const params = symbol ? { symbol } : {};
    const result = await this.client.get<PremiumIndex | PremiumIndex[]>(
      '/fapi/v1/premiumIndex',
      params,
      'futures'
    );
    return Array.isArray(result) ? result : [result];
  }

  /**
   * 获取资金费率信息
   */
  async getFundingRates(symbols?: string[]): Promise<FundingRateInfo[]> {
    const premiumIndexes = await this.getPremiumIndex();
    
    let filtered = premiumIndexes;
    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      filtered = premiumIndexes.filter((p) => symbolSet.has(p.symbol));
    }

    return filtered.map((p) => ({
      symbol: p.symbol,
      fundingRate: toDecimal(p.lastFundingRate),
      fundingInterval: this.getFundingInterval(p.nextFundingTime),
      nextFundingTime: new Date(p.nextFundingTime),
      markPrice: toDecimal(p.markPrice),
      indexPrice: toDecimal(p.indexPrice),
      timestamp: new Date(p.time),
    }));
  }

  /**
   * 根据下次结算时间推断结算周期
   */
  private getFundingInterval(nextFundingTime: number): number {
    // 币安目前支持 1h/4h/8h 周期
    // 通过判断下次结算时间与当前的间隔来推断
    const now = Date.now();
    const diff = nextFundingTime - now;
    
    // 如果小于 1.5 小时，可能是 1h 周期
    if (diff < 1.5 * 60 * 60 * 1000) {
      // 检查是否接近整点
      const nextTime = new Date(nextFundingTime);
      if (nextTime.getMinutes() === 0) {
        return 1;
      }
    }
    
    // 如果小于 4.5 小时，可能是 4h 周期
    if (diff < 4.5 * 60 * 60 * 1000) {
      return 4;
    }
    
    // 默认 8h 周期
    return 8;
  }

  /**
   * 获取历史资金费率
   */
  async getFundingRateHistory(
    symbol: string,
    startTime?: Date,
    endTime?: Date,
    limit: number = 1000
  ): Promise<FundingRateResponse[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      symbol,
      limit,
    };
    
    if (startTime) {
      params.startTime = startTime.getTime();
    }
    if (endTime) {
      params.endTime = endTime.getTime();
    }

    return this.client.get<FundingRateResponse[]>('/fapi/v1/fundingRate', params, 'futures');
  }

  /**
   * 获取订单簿深度
   */
  async getDepth(symbol: string, limit: number = 20): Promise<OrderBook> {
    const result = await this.client.get<FuturesDepth>(
      '/fapi/v1/depth',
      { symbol, limit },
      'futures'
    );
    
    return {
      symbol,
      bids: result.bids.map(([price, qty]) => [toDecimal(price), toDecimal(qty)]),
      asks: result.asks.map(([price, qty]) => [toDecimal(price), toDecimal(qty)]),
      timestamp: new Date(result.T),
    };
  }

  /**
   * 获取 24 小时行情
   */
  async get24hTicker(symbol: string): Promise<Futures24hTicker> {
    console.log('futures get24hTicker symbol :>> ', symbol);
    return this.client.get<Futures24hTicker>('/fapi/v1/ticker/24hr', { symbol }, 'futures');
  }

  /**
   * 获取 24 小时成交量
   */
  async get24hVolume(symbol: string): Promise<Decimal> {
    const ticker = await this.get24hTicker(symbol);
    return toDecimal(ticker.quoteVolume);
  }

  // ===========================================
  // 账户信息
  // ===========================================

  /**
   * 获取账户信息
   */
  async getAccount(): Promise<FuturesAccountInfo> {
    return this.client.get<FuturesAccountInfo>('/fapi/v2/account', {}, 'futures', true);
  }

  /**
   * 获取账户余额
   */
  async getBalances(): Promise<Balance[]> {
    const account = await this.getAccount();
    
    return account.assets
      .filter((a) => parseFloat(a.walletBalance) > 0)
      .map((a) => ({
        asset: a.asset,
        free: toDecimal(a.availableBalance),
        locked: toDecimal(a.walletBalance).minus(toDecimal(a.availableBalance)),
        total: toDecimal(a.walletBalance),
      }));
  }

  /**
   * 获取 USDT 余额
   */
  async getUsdtBalance(): Promise<Balance | null> {
    const balances = await this.getBalances();
    return balances.find((b) => b.asset === 'USDT') ?? null;
  }

  /**
   * 获取总权益
   */
  async getTotalEquity(): Promise<Decimal> {
    const account = await this.getAccount();
    return toDecimal(account.totalWalletBalance);
  }

  /**
   * 获取可用余额
   */
  async getAvailableBalance(): Promise<Decimal> {
    const account = await this.getAccount();
    return toDecimal(account.availableBalance);
  }

  // ===========================================
  // 持仓信息
  // ===========================================

  /**
   * 获取持仓风险信息
   */
  async getPositionRisk(symbol?: string): Promise<FuturesPositionRisk[]> {
    const params = symbol ? { symbol } : {};
    return this.client.get<FuturesPositionRisk[]>(
      '/fapi/v2/positionRisk',
      params,
      'futures',
      true
    );
  }

  /**
   * 获取所有持仓
   */
  async getPositions(symbols?: string[]): Promise<FuturesPosition[]> {
    const risks = await this.getPositionRisk();
    
    let filtered = risks.filter((r) => parseFloat(r.positionAmt) !== 0);
    
    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      filtered = filtered.filter((r) => symbolSet.has(r.symbol));
    }

    return filtered.map((r) => ({
      symbol: r.symbol,
      positionSide: r.positionSide as PositionSide,
      positionAmt: toDecimal(r.positionAmt),
      entryPrice: toDecimal(r.entryPrice),
      markPrice: toDecimal(r.markPrice),
      unrealizedProfit: toDecimal(r.unRealizedProfit),
      liquidationPrice: toDecimal(r.liquidationPrice),
      leverage: parseInt(r.leverage, 10),
      marginType: r.marginType as 'isolated' | 'cross',
      isolatedMargin: toDecimal(r.isolatedMargin),
      notional: toDecimal(r.notional),
      updateTime: new Date(r.updateTime),
    }));
  }

  /**
   * 获取指定 symbol 的持仓
   */
  async getPosition(symbol: string): Promise<FuturesPosition | null> {
    const positions = await this.getPositions([symbol]);
    return positions[0] ?? null;
  }

  // ===========================================
  // 交易操作
  // ===========================================

  /**
   * 下单
   */
  async placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: Decimal;
    price?: Decimal;
    positionSide?: PositionSide;
    reduceOnly?: boolean;
    clientOrderId?: string;
  }): Promise<Order> {
    const orderParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity.toString(),
      positionSide: params.positionSide ?? 'BOTH',
      reduceOnly: params.reduceOnly,
      newClientOrderId: params.clientOrderId,
    };

    if (params.type === OrderType.LIMIT && params.price) {
      orderParams.price = params.price.toString();
      orderParams.timeInForce = 'GTC';
    }

    const result = await this.client.post<FuturesOrderResponse>(
      '/fapi/v1/order',
      orderParams,
      'futures',
      true
    );

    return this.mapOrderResponse(result);
  }

  /**
   * 市价开多
   */
  async openLong(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity,
      positionSide: PositionSide.BOTH,
      clientOrderId,
    });
  }

  /**
   * 市价开空
   */
  async openShort(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity,
      positionSide: PositionSide.BOTH,
      clientOrderId,
    });
  }

  /**
   * 市价平多
   */
  async closeLong(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity,
      positionSide: PositionSide.BOTH,
      reduceOnly: true,
      clientOrderId,
    });
  }

  /**
   * 市价平空
   */
  async closeShort(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity,
      positionSide: PositionSide.BOTH,
      reduceOnly: true,
      clientOrderId,
    });
  }

  /**
   * 限价开空
   */
  async limitOpenShort(
    symbol: string,
    quantity: Decimal,
    price: Decimal,
    clientOrderId?: string
  ): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.SELL,
      type: OrderType.LIMIT,
      quantity,
      price,
      positionSide: PositionSide.BOTH,
      clientOrderId,
    });
  }

  /**
   * 限价平空
   */
  async limitCloseShort(
    symbol: string,
    quantity: Decimal,
    price: Decimal,
    clientOrderId?: string
  ): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity,
      price,
      positionSide: PositionSide.BOTH,
      reduceOnly: true,
      clientOrderId,
    });
  }

  /**
   * 查询订单
   */
  async getOrder(symbol: string, orderId: number): Promise<Order> {
    const result = await this.client.get<FuturesOrderQueryResponse>(
      '/fapi/v1/order',
      { symbol, orderId },
      'futures',
      true
    );

    return this.mapQueryOrderResponse(result);
  }

  /**
   * 取消订单
   */
  async cancelOrder(symbol: string, orderId: number): Promise<boolean> {
    try {
      await this.client.delete<FuturesOrderResponse>(
        '/fapi/v1/order',
        { symbol, orderId },
        'futures',
        true
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前挂单
   */
  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params = symbol ? { symbol } : {};
    const results = await this.client.get<FuturesOrderQueryResponse[]>(
      '/fapi/v1/openOrders',
      params,
      'futures',
      true
    );

    return results.map((r) => this.mapQueryOrderResponse(r));
  }

  // ===========================================
  // 杠杆和保证金
  // ===========================================

  /**
   * 设置杠杆
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.client.post(
      '/fapi/v1/leverage',
      { symbol, leverage },
      'futures',
      true
    );
  }

  /**
   * 设置保证金模式
   */
  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    try {
      await this.client.post(
        '/fapi/v1/marginType',
        { symbol, marginType },
        'futures',
        true
      );
    } catch (error) {
      // 如果已经是目标模式，会报错，忽略
      if ((error as Error).message?.includes('No need to change')) {
        return;
      }
      throw error;
    }
  }

  // ===========================================
  // 资金划转
  // ===========================================

  /**
   * 现货到合约划转
   */
  async transferFromSpot(amount: Decimal, asset: string = 'USDT'): Promise<number> {
    const result = await this.client.post<TransferResponse>(
      '/sapi/v1/asset/transfer',
      {
        type: 'MAIN_UMFUTURE',
        asset,
        amount: amount.toString(),
      },
      'spot',
      true
    );
    return result.tranId;
  }

  /**
   * 合约到现货划转
   */
  async transferToSpot(amount: Decimal, asset: string = 'USDT'): Promise<number> {
    const result = await this.client.post<TransferResponse>(
      '/sapi/v1/asset/transfer',
      {
        type: 'UMFUTURE_MAIN',
        asset,
        amount: amount.toString(),
      },
      'spot',
      true
    );
    return result.tranId;
  }

  // ===========================================
  // 辅助方法
  // ===========================================

  /**
   * 转换订单响应
   */
  private mapOrderResponse(response: FuturesOrderResponse): Order {
    return {
      orderId: String(response.orderId),
      clientOrderId: response.clientOrderId,
      symbol: response.symbol,
      side: response.side as OrderSide,
      type: response.type as OrderType,
      status: response.status as OrderStatus,
      price: toDecimal(response.price),
      quantity: toDecimal(response.origQty),
      executedQty: toDecimal(response.executedQty),
      avgPrice: toDecimal(response.avgPrice),
      marketType: MarketType.FUTURES,
      createdAt: new Date(response.updateTime),
      updatedAt: new Date(response.updateTime),
    };
  }

  /**
   * 转换查询订单响应
   */
  private mapQueryOrderResponse(response: FuturesOrderQueryResponse): Order {
    return {
      orderId: String(response.orderId),
      clientOrderId: response.clientOrderId,
      symbol: response.symbol,
      side: response.side as OrderSide,
      type: response.type as OrderType,
      status: response.status as OrderStatus,
      price: toDecimal(response.price),
      quantity: toDecimal(response.origQty),
      executedQty: toDecimal(response.executedQty),
      avgPrice: toDecimal(response.avgPrice),
      marketType: MarketType.FUTURES,
      createdAt: new Date(response.time),
      updatedAt: new Date(response.updateTime),
    };
  }
}
