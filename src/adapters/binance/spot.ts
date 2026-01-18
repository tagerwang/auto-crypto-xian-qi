/**
 * 币安现货 API 封装
 */

import { Decimal, toDecimal } from '../../utils/decimal.js';
import { BinanceRestClient } from './client.js';
import {
  SpotAccountInfo,
  SpotOrderResponse,
  SpotOrderQueryResponse,
  SpotBookTicker,
  SpotDepth,
  Spot24hTicker,
  SpotExchangeInfo,
  SpotTickerPrice,
} from './types.js';
import {
  Balance,
  Order,
  OrderBook,
  OrderSide,
  OrderStatus,
  OrderType,
  MarketType,
} from '../../types/index.js';

/**
 * 现货 API 客户端
 */
export class SpotApi {
  constructor(private readonly client: BinanceRestClient) {}

  // ===========================================
  // 市场数据
  // ===========================================

  /**
   * 获取交易所信息
   */
  async getExchangeInfo(): Promise<SpotExchangeInfo> {
    return this.client.get<SpotExchangeInfo>('/api/v3/exchangeInfo', {}, 'spot');
  }

  /**
   * 获取当前价格
   */
  async getPrice(symbol: string): Promise<Decimal> {
    const result = await this.client.get<SpotTickerPrice>(
      '/api/v3/ticker/price',
      { symbol },
      'spot'
    );
    return toDecimal(result.price);
  }

  /**
   * 获取多个交易对价格
   */
  async getPrices(symbols?: string[]): Promise<Map<string, Decimal>> {
    const params = symbols ? { symbols: JSON.stringify(symbols) } : {};
    const results = await this.client.get<SpotTickerPrice[]>('/api/v3/ticker/price', params, 'spot');
    
    const priceMap = new Map<string, Decimal>();
    for (const item of results) {
      priceMap.set(item.symbol, toDecimal(item.price));
    }
    return priceMap;
  }

  /**
   * 获取最优买卖价
   */
  async getBookTicker(symbol: string): Promise<SpotBookTicker> {
    return this.client.get<SpotBookTicker>('/api/v3/ticker/bookTicker', { symbol }, 'spot');
  }

  /**
   * 获取订单簿深度
   */
  async getDepth(symbol: string, limit: number = 20): Promise<OrderBook> {
    const result = await this.client.get<SpotDepth>(
      '/api/v3/depth',
      { symbol, limit },
      'spot'
    );
    
    return {
      symbol,
      bids: result.bids.map(([price, qty]) => [toDecimal(price), toDecimal(qty)]),
      asks: result.asks.map(([price, qty]) => [toDecimal(price), toDecimal(qty)]),
      timestamp: new Date(),
    };
  }

  /**
   * 获取 24 小时行情
   */
  async get24hTicker(symbol: string): Promise<Spot24hTicker> {
    console.log('spot get24hTicker symbol:>> ', symbol);
    return this.client.get<Spot24hTicker>('/api/v3/ticker/24hr', { symbol }, 'spot');
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
  async getAccount(): Promise<SpotAccountInfo> {
    return this.client.get<SpotAccountInfo>('/api/v3/account', {}, 'spot', true);
  }

  /**
   * 获取账户余额
   */
  async getBalances(): Promise<Balance[]> {
    const account = await this.getAccount();
    
    return account.balances
      .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
      .map((b) => ({
        asset: b.asset,
        free: toDecimal(b.free),
        locked: toDecimal(b.locked),
        total: toDecimal(b.free).plus(toDecimal(b.locked)),
      }));
  }

  /**
   * 获取指定资产余额
   */
  async getBalance(asset: string): Promise<Balance | null> {
    const balances = await this.getBalances();
    return balances.find((b) => b.asset === asset) ?? null;
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
    clientOrderId?: string;
  }): Promise<Order> {
    const orderParams: Record<string, string | number | boolean | undefined> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity.toString(),
      newClientOrderId: params.clientOrderId,
    };

    if (params.type === OrderType.LIMIT && params.price) {
      orderParams.price = params.price.toString();
      orderParams.timeInForce = 'GTC';
    }

    const result = await this.client.post<SpotOrderResponse>(
      '/api/v3/order',
      orderParams,
      'spot',
      true
    );

    return this.mapOrderResponse(result);
  }

  /**
   * 市价买入
   */
  async marketBuy(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity,
      clientOrderId,
    });
  }

  /**
   * 市价卖出
   */
  async marketSell(symbol: string, quantity: Decimal, clientOrderId?: string): Promise<Order> {
    return this.placeOrder({
      symbol,
      side: OrderSide.SELL,
      type: OrderType.MARKET,
      quantity,
      clientOrderId,
    });
  }

  /**
   * 限价买入
   */
  async limitBuy(
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
      clientOrderId,
    });
  }

  /**
   * 限价卖出
   */
  async limitSell(
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
      clientOrderId,
    });
  }

  /**
   * 查询订单
   */
  async getOrder(symbol: string, orderId: number): Promise<Order> {
    const result = await this.client.get<SpotOrderQueryResponse>(
      '/api/v3/order',
      { symbol, orderId },
      'spot',
      true
    );

    return this.mapQueryOrderResponse(result);
  }

  /**
   * 取消订单
   */
  async cancelOrder(symbol: string, orderId: number): Promise<boolean> {
    try {
      await this.client.delete<SpotOrderResponse>(
        '/api/v3/order',
        { symbol, orderId },
        'spot',
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
    const results = await this.client.get<SpotOrderQueryResponse[]>(
      '/api/v3/openOrders',
      params,
      'spot',
      true
    );

    return results.map((r) => this.mapQueryOrderResponse(r));
  }

  // ===========================================
  // 辅助方法
  // ===========================================

  /**
   * 转换订单响应
   */
  private mapOrderResponse(response: SpotOrderResponse): Order {
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
      avgPrice: toDecimal(response.cummulativeQuoteQty).div(
        toDecimal(response.executedQty).isZero()
          ? toDecimal(1)
          : toDecimal(response.executedQty)
      ),
      marketType: MarketType.SPOT,
      createdAt: new Date(response.transactTime),
      updatedAt: new Date(response.transactTime),
    };
  }

  /**
   * 转换查询订单响应
   */
  private mapQueryOrderResponse(response: SpotOrderQueryResponse): Order {
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
      avgPrice: toDecimal(response.cummulativeQuoteQty).div(
        toDecimal(response.executedQty).isZero()
          ? toDecimal(1)
          : toDecimal(response.executedQty)
      ),
      marketType: MarketType.SPOT,
      createdAt: new Date(response.time),
      updatedAt: new Date(response.updateTime),
    };
  }
}
