/**
 * 订单执行器
 * 
 * 功能：
 * - 原子化双边下单
 * - 成交验证
 * - 异常回滚
 * - 部分成交处理
 */

import { v4 as uuidv4 } from 'uuid';
import { BinanceAdapter } from '../adapters/binance/index.js';
import { logger, logTrade } from '../utils/logger.js';
import { Decimal, toDecimal, safeDivide, decimalMin } from '../utils/decimal.js';
import { withTimeout } from '../utils/retry.js';
import { ExecutionConfig } from '../config/schema.js';
import { PositionManager } from './position.js';
import { orderRepository, positionRepository } from '../db/repository.js';
import {
  Signal,
  SignalType,
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  MarketType,
  ArbitragePosition,
  ArbitragePositionStatus,
} from '../types/index.js';

export interface ExecutionResult {
  success: boolean;
  positionId?: string;
  spotOrder?: Order;
  futuresOrder?: Order;
  error?: string;
}

/**
 * 订单执行器
 */
export class Executor {
  constructor(
    private readonly adapter: BinanceAdapter,
    private readonly config: ExecutionConfig,
    private readonly positionManager: PositionManager
  ) {}

  // ===========================================
  // 执行信号
  // ===========================================

  /**
   * 执行交易信号
   */
  async executeSignal(signal: Signal): Promise<ExecutionResult> {
    logger.info({ signal }, '开始执行信号');

    try {
      if (signal.type === SignalType.OPEN) {
        return await this.executeOpenSignal(signal);
      } else if (signal.type === SignalType.CLOSE) {
        return await this.executeCloseSignal(signal);
      } else {
        return { success: false, error: '未知信号类型' };
      }
    } catch (error) {
      logger.error({ signal, error }, '执行信号失败');
      logTrade('ERROR', {
        symbol: signal.symbol,
        error,
        reason: '执行信号失败',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  // ===========================================
  // 开仓执行
  // ===========================================

  /**
   * 执行开仓信号
   */
  private async executeOpenSignal(signal: Signal): Promise<ExecutionResult> {
    const { symbol } = signal;
    const clientOrderId = `OPEN_${uuidv4().slice(0, 8)}`;

    // 1. 获取当前价格
    const { bid: spotBid, ask: spotAsk } = await this.adapter.getBestPrices(symbol);
    const futuresBook = await this.adapter.getOrderBook(symbol, MarketType.FUTURES);
    const futuresBid = futuresBook.bids[0]?.[0] ?? spotAsk;

    // 2. 计算开仓数量
    const availableBalance = await this.adapter.getAvailableBalance();
    const totalAvailable = availableBalance.spot.plus(availableBalance.futures);
    
    // 简化：使用固定比例计算
    const positionValue = totalAvailable.mul(0.1); // 10% 仓位
    const quantity = safeDivide(positionValue, spotAsk);

    if (quantity.lte(0)) {
      return { success: false, error: '可用余额不足' };
    }

    logger.info(
      { symbol, quantity: quantity.toString(), spotPrice: spotAsk.toString() },
      '准备开仓'
    );

    // 3. 创建持仓记录（状态：OPENING）
    const position = await positionRepository.create({
      symbol,
      status: 'OPENING',
      spotQuantity: quantity.toString(),
      spotEntryPrice: spotAsk.toString(),
      futuresQuantity: quantity.toString(),
      futuresEntryPrice: futuresBid.toString(),
      fundingInterval: signal.fundingInterval ?? 8,
      totalFundingCollected: '0',
      fundingRecordCount: 0,
      unrealizedPnl: '0',
      entryAnnualizedReturn: signal.annualizedReturn?.toString(),
      openedAt: new Date(),
    });

    try {
      // 4. 设置合约杠杆和保证金模式
      await this.adapter.setLeverage(symbol, 2);
      await this.adapter.setMarginType(symbol, 'CROSSED');

      // 5. 原子化双边下单
      const result = await this.executeAtomicOpen(
        symbol,
        quantity,
        spotAsk,
        futuresBid,
        clientOrderId,
        position.id
      );

      if (!result.success) {
        // 更新持仓状态为 ERROR
        await positionRepository.update(position.id, { status: 'ERROR' });
        return result;
      }

      // 6. 更新持仓状态为 ACTIVE
      await positionRepository.update(position.id, {
        status: 'ACTIVE',
        spotOrderId: result.spotOrder?.orderId,
        futuresOrderId: result.futuresOrder?.orderId,
        spotQuantity: result.spotOrder?.executedQty.toString(),
        futuresQuantity: result.futuresOrder?.executedQty.toString(),
        spotEntryPrice: result.spotOrder?.avgPrice.toString(),
        futuresEntryPrice: result.futuresOrder?.avgPrice.toString(),
      });

      logTrade('OPEN', {
        symbol,
        positionId: position.id,
        spotQuantity: result.spotOrder?.executedQty.toString(),
        spotPrice: result.spotOrder?.avgPrice.toString(),
        futuresQuantity: result.futuresOrder?.executedQty.toString(),
        futuresPrice: result.futuresOrder?.avgPrice.toString(),
      });

      return {
        success: true,
        positionId: position.id,
        spotOrder: result.spotOrder,
        futuresOrder: result.futuresOrder,
      };
    } catch (error) {
      // 发生错误，更新持仓状态
      await positionRepository.update(position.id, {
        status: 'ERROR',
        metadata: JSON.stringify({ error: (error as Error).message }),
      });
      throw error;
    }
  }

  /**
   * 原子化开仓
   */
  private async executeAtomicOpen(
    symbol: string,
    quantity: Decimal,
    spotPrice: Decimal,
    futuresPrice: Decimal,
    clientOrderId: string,
    positionId: string
  ): Promise<ExecutionResult> {
    let spotOrder: Order | undefined;
    let futuresOrder: Order | undefined;

    try {
      // 并行下单
      if (this.config.useLimitOrders) {
        // 限价单
        [spotOrder, futuresOrder] = await withTimeout(
          Promise.all([
            this.adapter.spotLimitBuy(symbol, quantity, spotPrice),
            this.adapter.futuresLimitOpenShort(symbol, quantity, futuresPrice),
          ]),
          this.config.totalTimeoutSeconds * 1000,
          '下单超时'
        );
      } else {
        // 市价单
        [spotOrder, futuresOrder] = await withTimeout(
          Promise.all([
            this.adapter.spotBuy(symbol, quantity),
            this.adapter.futuresOpenShort(symbol, quantity),
          ]),
          this.config.totalTimeoutSeconds * 1000,
          '下单超时'
        );
      }

      // 保存订单记录
      await Promise.all([
        orderRepository.create({
          positionId,
          orderId: spotOrder.orderId,
          clientOrderId: spotOrder.clientOrderId ?? clientOrderId + '_SPOT',
          symbol,
          marketType: 'spot',
          side: 'BUY',
          orderType: spotOrder.type,
          status: spotOrder.status,
          price: spotOrder.price.toString(),
          quantity: spotOrder.quantity.toString(),
          executedQty: spotOrder.executedQty.toString(),
          avgPrice: spotOrder.avgPrice.toString(),
        }),
        orderRepository.create({
          positionId,
          orderId: futuresOrder.orderId,
          clientOrderId: futuresOrder.clientOrderId ?? clientOrderId + '_FUTURES',
          symbol,
          marketType: 'futures',
          side: 'SELL',
          orderType: futuresOrder.type,
          status: futuresOrder.status,
          price: futuresOrder.price.toString(),
          quantity: futuresOrder.quantity.toString(),
          executedQty: futuresOrder.executedQty.toString(),
          avgPrice: futuresOrder.avgPrice.toString(),
        }),
      ]);

      // 等待订单成交
      [spotOrder, futuresOrder] = await this.waitForFills(
        symbol,
        spotOrder,
        futuresOrder
      );

      // 验证成交数量
      const quantityDiff = spotOrder.executedQty
        .minus(futuresOrder.executedQty)
        .abs()
        .div(spotOrder.executedQty);

      if (quantityDiff.gt(this.config.quantityTolerancePct)) {
        logger.warn(
          { symbol, spotQty: spotOrder.executedQty.toString(), futuresQty: futuresOrder.executedQty.toString() },
          '双边成交数量偏差过大'
        );
        // 调整到较小数量
        await this.alignQuantities(symbol, spotOrder, futuresOrder);
      }

      return { success: true, spotOrder, futuresOrder };
    } catch (error) {
      // 回滚逻辑
      logger.error({ symbol, error }, '开仓失败，执行回滚');
      await this.rollbackOpen(symbol, spotOrder, futuresOrder);
      return {
        success: false,
        error: error instanceof Error ? error.message : '开仓失败',
        spotOrder,
        futuresOrder,
      };
    }
  }

  /**
   * 等待订单成交
   */
  private async waitForFills(
    symbol: string,
    spotOrder: Order,
    futuresOrder: Order
  ): Promise<[Order, Order]> {
    const timeout = this.config.legTimeoutSeconds * 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 查询订单状态
      const [spotStatus, futuresStatus] = await Promise.all([
        this.adapter.getOrderStatus(spotOrder.orderId, symbol, MarketType.SPOT),
        this.adapter.getOrderStatus(futuresOrder.orderId, symbol, MarketType.FUTURES),
      ]);

      // 检查是否全部成交
      if (
        spotStatus.status === OrderStatus.FILLED &&
        futuresStatus.status === OrderStatus.FILLED
      ) {
        return [spotStatus, futuresStatus];
      }

      // 检查是否有订单被拒绝
      if (
        spotStatus.status === OrderStatus.REJECTED ||
        futuresStatus.status === OrderStatus.REJECTED
      ) {
        throw new Error('订单被拒绝');
      }

      // 等待一段时间后重试
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // 超时处理：取消未成交的订单
    if (spotOrder.status !== OrderStatus.FILLED) {
      await this.adapter.cancelOrder(spotOrder.orderId, symbol, MarketType.SPOT);
    }
    if (futuresOrder.status !== OrderStatus.FILLED) {
      await this.adapter.cancelOrder(futuresOrder.orderId, symbol, MarketType.FUTURES);
    }

    throw new Error('等待订单成交超时');
  }

  /**
   * 调整双边数量一致
   */
  private async alignQuantities(
    symbol: string,
    spotOrder: Order,
    futuresOrder: Order
  ): Promise<void> {
    const spotQty = spotOrder.executedQty;
    const futuresQty = futuresOrder.executedQty;
    const minQty = decimalMin(spotQty, futuresQty);

    if (spotQty.gt(minQty)) {
      // 卖出多余的现货
      const excessQty = spotQty.minus(minQty);
      await this.adapter.spotSell(symbol, excessQty);
      logger.info({ symbol, excessQty: excessQty.toString() }, '卖出多余现货');
    }

    if (futuresQty.gt(minQty)) {
      // 平掉多余的空单
      const excessQty = futuresQty.minus(minQty);
      await this.adapter.futuresCloseShort(symbol, excessQty);
      logger.info({ symbol, excessQty: excessQty.toString() }, '平掉多余空单');
    }
  }

  /**
   * 回滚开仓
   */
  private async rollbackOpen(
    symbol: string,
    spotOrder?: Order,
    futuresOrder?: Order
  ): Promise<void> {
    try {
      // 取消未成交订单
      if (spotOrder && spotOrder.status !== OrderStatus.FILLED) {
        await this.adapter.cancelOrder(spotOrder.orderId, symbol, MarketType.SPOT);
      }
      if (futuresOrder && futuresOrder.status !== OrderStatus.FILLED) {
        await this.adapter.cancelOrder(futuresOrder.orderId, symbol, MarketType.FUTURES);
      }

      // 平掉已成交的部分
      if (spotOrder && spotOrder.executedQty.gt(0)) {
        await this.adapter.spotSell(symbol, spotOrder.executedQty);
        logTrade('CANCEL', { symbol, side: 'SPOT', quantity: spotOrder.executedQty.toString() });
      }
      if (futuresOrder && futuresOrder.executedQty.gt(0)) {
        await this.adapter.futuresCloseShort(symbol, futuresOrder.executedQty);
        logTrade('CANCEL', { symbol, side: 'FUTURES', quantity: futuresOrder.executedQty.toString() });
      }
    } catch (error) {
      logger.error({ symbol, error }, '回滚开仓失败');
    }
  }

  // ===========================================
  // 平仓执行
  // ===========================================

  /**
   * 执行平仓信号
   */
  private async executeCloseSignal(signal: Signal): Promise<ExecutionResult> {
    if (!signal.positionId) {
      return { success: false, error: '缺少持仓 ID' };
    }

    const position = await positionRepository.findById(signal.positionId);
    if (!position) {
      return { success: false, error: '持仓不存在' };
    }

    if (position.status !== 'ACTIVE') {
      return { success: false, error: `持仓状态异常: ${position.status}` };
    }

    const { symbol } = position;
    const spotQuantity = toDecimal(position.spotQuantity);
    const futuresQuantity = toDecimal(position.futuresQuantity);

    logger.info(
      { symbol, positionId: position.id, reason: signal.closeReason },
      '准备平仓'
    );

    // 更新持仓状态为 CLOSING
    await positionRepository.update(position.id, { status: 'CLOSING' });

    try {
      // 执行平仓
      const result = await this.executeAtomicClose(
        symbol,
        spotQuantity,
        futuresQuantity,
        position.id
      );

      if (!result.success) {
        await positionRepository.update(position.id, { status: 'ACTIVE' }); // 回滚状态
        return result;
      }

      // 计算最终盈亏
      const spotPnL = result.spotOrder
        ? result.spotOrder.avgPrice.minus(toDecimal(position.spotEntryPrice)).mul(result.spotOrder.executedQty)
        : toDecimal(0);
      const futuresPnL = result.futuresOrder
        ? toDecimal(position.futuresEntryPrice).minus(result.futuresOrder.avgPrice).mul(result.futuresOrder.executedQty)
        : toDecimal(0);
      const totalPnL = spotPnL.plus(futuresPnL).plus(toDecimal(position.totalFundingCollected));

      // 更新持仓状态为 CLOSED
      await positionRepository.update(position.id, {
        status: 'CLOSED',
        spotExitPrice: result.spotOrder?.avgPrice.toString(),
        futuresExitPrice: result.futuresOrder?.avgPrice.toString(),
        spotCloseOrderId: result.spotOrder?.orderId,
        futuresCloseOrderId: result.futuresOrder?.orderId,
        realizedPnl: totalPnL.toString(),
        closeReason: signal.closeReason,
        closedAt: new Date(),
      });

      logTrade('CLOSE', {
        symbol,
        positionId: position.id,
        reason: signal.closeReason,
        spotPrice: result.spotOrder?.avgPrice.toString(),
        futuresPrice: result.futuresOrder?.avgPrice.toString(),
        realizedPnL: totalPnL.toString(),
      });

      return {
        success: true,
        positionId: position.id,
        spotOrder: result.spotOrder,
        futuresOrder: result.futuresOrder,
      };
    } catch (error) {
      logger.error({ symbol, positionId: position.id, error }, '平仓失败');
      await positionRepository.update(position.id, { status: 'ACTIVE' }); // 回滚状态
      throw error;
    }
  }

  /**
   * 原子化平仓
   */
  private async executeAtomicClose(
    symbol: string,
    spotQuantity: Decimal,
    futuresQuantity: Decimal,
    positionId: string
  ): Promise<ExecutionResult> {
    try {
      // 市价平仓（紧急情况优先保证成交）
      const [spotOrder, futuresOrder] = await withTimeout(
        Promise.all([
          this.adapter.spotSell(symbol, spotQuantity),
          this.adapter.futuresCloseShort(symbol, futuresQuantity),
        ]),
        this.config.totalTimeoutSeconds * 1000,
        '平仓超时'
      );

      // 保存订单记录
      await Promise.all([
        orderRepository.create({
          positionId,
          orderId: spotOrder.orderId,
          symbol,
          marketType: 'spot',
          side: 'SELL',
          orderType: spotOrder.type,
          status: spotOrder.status,
          price: spotOrder.price.toString(),
          quantity: spotOrder.quantity.toString(),
          executedQty: spotOrder.executedQty.toString(),
          avgPrice: spotOrder.avgPrice.toString(),
        }),
        orderRepository.create({
          positionId,
          orderId: futuresOrder.orderId,
          symbol,
          marketType: 'futures',
          side: 'BUY',
          orderType: futuresOrder.type,
          status: futuresOrder.status,
          price: futuresOrder.price.toString(),
          quantity: futuresOrder.quantity.toString(),
          executedQty: futuresOrder.executedQty.toString(),
          avgPrice: futuresOrder.avgPrice.toString(),
        }),
      ]);

      return { success: true, spotOrder, futuresOrder };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '平仓失败',
      };
    }
  }

  // ===========================================
  // 批量执行
  // ===========================================

  /**
   * 批量执行信号
   */
  async executeSignals(signals: Signal[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    
    // 按优先级排序
    const sortedSignals = [...signals].sort((a, b) => b.priority - a.priority);

    // 串行执行，避免并发问题
    for (const signal of sortedSignals) {
      // 检查间隔
      await new Promise((resolve) => setTimeout(resolve, this.config.orderInterval));
      
      const result = await this.executeSignal(signal);
      results.push(result);

      // 如果超过并发限制，等待
      const activeCount = results.filter((r) => r.success).length;
      if (activeCount >= this.config.maxConcurrentOrders) {
        logger.info('达到并发限制，暂停执行');
        break;
      }
    }

    return results;
  }
}
