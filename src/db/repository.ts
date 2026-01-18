/**
 * 数据访问层
 * 
 * 封装所有数据库操作
 */

import { eq, and, gte, lte, desc, asc, sql, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './index.js';
import {
  positions,
  fundingRecords,
  orders,
  signals,
  backtestResults,
  alerts,
  systemState,
  fundingRateHistory,
  type Position,
  type NewPosition,
  type FundingRecord,
  type NewFundingRecord,
  type Order,
  type NewOrder,
  type Signal,
  type NewSignal,
  type BacktestResult,
  type NewBacktestResult,
  type Alert,
  type NewAlert,
  type SystemState,
  type FundingRateHistoryRecord,
  type NewFundingRateHistoryRecord,
} from './schema.js';

// ===========================================
// 持仓相关操作
// ===========================================

export const positionRepository = {
  /**
   * 创建新持仓
   */
  async create(data: Omit<NewPosition, 'id'>): Promise<Position> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(positions).values({ ...data, id });
    const [result] = await db.select().from(positions).where(eq(positions.id, id));
    return result!;
  },

  /**
   * 根据 ID 获取持仓
   */
  async findById(id: string): Promise<Position | null> {
    const db = getDb();
    const [result] = await db.select().from(positions).where(eq(positions.id, id));
    return result ?? null;
  },

  /**
   * 获取所有活跃持仓
   */
  async findActive(): Promise<Position[]> {
    const db = getDb();
    return db.select().from(positions).where(eq(positions.status, 'ACTIVE'));
  },

  /**
   * 根据状态获取持仓
   */
  async findByStatus(status: string): Promise<Position[]> {
    const db = getDb();
    return db.select().from(positions).where(eq(positions.status, status));
  },

  /**
   * 根据 symbol 获取活跃持仓
   */
  async findActiveBySymbol(symbol: string): Promise<Position | null> {
    const db = getDb();
    const [result] = await db
      .select()
      .from(positions)
      .where(and(eq(positions.symbol, symbol), eq(positions.status, 'ACTIVE')));
    return result ?? null;
  },

  /**
   * 更新持仓
   */
  async update(id: string, data: Partial<NewPosition>): Promise<void> {
    const db = getDb();
    await db.update(positions).set(data).where(eq(positions.id, id));
  },

  /**
   * 获取持仓历史
   */
  async findHistory(limit: number = 100): Promise<Position[]> {
    const db = getDb();
    return db
      .select()
      .from(positions)
      .where(eq(positions.status, 'CLOSED'))
      .orderBy(desc(positions.closedAt))
      .limit(limit);
  },

  /**
   * 统计活跃持仓数量
   */
  async countActive(): Promise<number> {
    const db = getDb();
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(positions)
      .where(eq(positions.status, 'ACTIVE'));
    return result?.count ?? 0;
  },
};

// ===========================================
// 费率记录相关操作
// ===========================================

export const fundingRecordRepository = {
  /**
   * 创建费率记录
   */
  async create(data: Omit<NewFundingRecord, 'id'>): Promise<FundingRecord> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(fundingRecords).values({ ...data, id });
    const [result] = await db.select().from(fundingRecords).where(eq(fundingRecords.id, id));
    return result!;
  },

  /**
   * 批量创建费率记录
   */
  async createMany(records: Array<Omit<NewFundingRecord, 'id'>>): Promise<void> {
    const db = getDb();
    const recordsWithIds = records.map((r) => ({ ...r, id: uuidv4() }));
    await db.insert(fundingRecords).values(recordsWithIds);
  },

  /**
   * 根据持仓 ID 获取费率记录
   */
  async findByPositionId(positionId: string): Promise<FundingRecord[]> {
    const db = getDb();
    return db
      .select()
      .from(fundingRecords)
      .where(eq(fundingRecords.positionId, positionId))
      .orderBy(desc(fundingRecords.settledAt));
  },

  /**
   * 计算持仓的累计费率收益
   */
  async sumFundingByPositionId(positionId: string): Promise<number> {
    const db = getDb();
    const [result] = await db
      .select({ total: sql<number>`COALESCE(SUM(funding_amount), 0)` })
      .from(fundingRecords)
      .where(eq(fundingRecords.positionId, positionId));
    return result?.total ?? 0;
  },
};

// ===========================================
// 订单相关操作
// ===========================================

export const orderRepository = {
  /**
   * 创建订单记录
   */
  async create(data: Omit<NewOrder, 'id'>): Promise<Order> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(orders).values({ ...data, id });
    const [result] = await db.select().from(orders).where(eq(orders.id, id));
    return result!;
  },

  /**
   * 根据订单 ID 更新
   */
  async updateByOrderId(orderId: string, marketType: string, data: Partial<NewOrder>): Promise<void> {
    const db = getDb();
    await db
      .update(orders)
      .set(data)
      .where(and(eq(orders.orderId, orderId), eq(orders.marketType, marketType)));
  },

  /**
   * 根据持仓 ID 获取订单
   */
  async findByPositionId(positionId: string): Promise<Order[]> {
    const db = getDb();
    return db.select().from(orders).where(eq(orders.positionId, positionId));
  },
};

// ===========================================
// 信号相关操作
// ===========================================

export const signalRepository = {
  /**
   * 创建信号
   */
  async create(data: Omit<NewSignal, 'id'>): Promise<Signal> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(signals).values({ ...data, id });
    const [result] = await db.select().from(signals).where(eq(signals.id, id));
    return result!;
  },

  /**
   * 获取待处理信号
   */
  async findPending(): Promise<Signal[]> {
    const db = getDb();
    return db
      .select()
      .from(signals)
      .where(eq(signals.status, 'PENDING'))
      .orderBy(desc(signals.priority), asc(signals.createdAt));
  },

  /**
   * 更新信号状态
   */
  async updateStatus(id: string, status: string, result?: Partial<NewSignal>): Promise<void> {
    const db = getDb();
    await db.update(signals).set({ status, ...result }).where(eq(signals.id, id));
  },

  /**
   * 检查 symbol 是否在冷却期
   */
  async isInCooldown(symbol: string, cooldownHours: number): Promise<boolean> {
    const db = getDb();
    const cooldownTime = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(signals)
      .where(
        and(
          eq(signals.symbol, symbol),
          eq(signals.type, 'CLOSE'),
          eq(signals.status, 'EXECUTED'),
          gte(signals.executedAt, cooldownTime)
        )
      );
    return (result?.count ?? 0) > 0;
  },
};

// ===========================================
// 回测结果相关操作
// ===========================================

export const backtestRepository = {
  /**
   * 保存回测结果
   */
  async create(data: Omit<NewBacktestResult, 'id'>): Promise<BacktestResult> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(backtestResults).values({ ...data, id });
    const [result] = await db.select().from(backtestResults).where(eq(backtestResults.id, id));
    return result!;
  },

  /**
   * 获取回测历史
   */
  async findHistory(limit: number = 20): Promise<BacktestResult[]> {
    const db = getDb();
    return db
      .select()
      .from(backtestResults)
      .orderBy(desc(backtestResults.executedAt))
      .limit(limit);
  },

  /**
   * 根据 ID 获取回测结果
   */
  async findById(id: string): Promise<BacktestResult | null> {
    const db = getDb();
    const [result] = await db.select().from(backtestResults).where(eq(backtestResults.id, id));
    return result ?? null;
  },
};

// ===========================================
// 告警相关操作
// ===========================================

export const alertRepository = {
  /**
   * 创建告警
   */
  async create(data: Omit<NewAlert, 'id'>): Promise<Alert> {
    const db = getDb();
    const id = uuidv4();
    await db.insert(alerts).values({ ...data, id });
    const [result] = await db.select().from(alerts).where(eq(alerts.id, id));
    return result!;
  },

  /**
   * 标记告警已发送
   */
  async markSent(id: string): Promise<void> {
    const db = getDb();
    await db.update(alerts).set({ sent: true, sentAt: new Date() }).where(eq(alerts.id, id));
  },

  /**
   * 获取最近告警
   */
  async findRecent(limit: number = 50): Promise<Alert[]> {
    const db = getDb();
    return db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(limit);
  },
};

// ===========================================
// 系统状态相关操作
// ===========================================

export const systemStateRepository = {
  /**
   * 获取系统状态
   */
  async get(): Promise<SystemState | null> {
    const db = getDb();
    const [result] = await db.select().from(systemState).where(eq(systemState.id, 1));
    return result ?? null;
  },

  /**
   * 更新系统状态
   */
  async update(data: Partial<SystemState>): Promise<void> {
    const db = getDb();
    await db
      .insert(systemState)
      .values({ id: 1, ...data })
      .onDuplicateKeyUpdate({ set: data });
  },
};

// ===========================================
// 历史费率缓存相关操作
// ===========================================

export const fundingRateHistoryRepository = {
  /**
   * 批量插入历史费率（忽略重复）
   */
  async upsertMany(records: NewFundingRateHistoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    
    const db = getDb();
    // 使用 INSERT IGNORE 忽略重复
    await db.insert(fundingRateHistory).values(records).onDuplicateKeyUpdate({
      set: { fundingRate: sql`funding_rate` }, // 不更新，保持原值
    });
  },

  /**
   * 获取指定 symbol 的历史费率
   */
  async findBySymbol(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<FundingRateHistoryRecord[]> {
    const db = getDb();
    return db
      .select()
      .from(fundingRateHistory)
      .where(
        and(
          eq(fundingRateHistory.symbol, symbol),
          gte(fundingRateHistory.fundingTime, startTime),
          lte(fundingRateHistory.fundingTime, endTime)
        )
      )
      .orderBy(asc(fundingRateHistory.fundingTime));
  },

  /**
   * 获取多个 symbol 的历史费率
   */
  async findBySymbols(
    symbols: string[],
    startTime: Date,
    endTime: Date
  ): Promise<FundingRateHistoryRecord[]> {
    if (symbols.length === 0) return [];
    
    const db = getDb();
    return db
      .select()
      .from(fundingRateHistory)
      .where(
        and(
          inArray(fundingRateHistory.symbol, symbols),
          gte(fundingRateHistory.fundingTime, startTime),
          lte(fundingRateHistory.fundingTime, endTime)
        )
      )
      .orderBy(asc(fundingRateHistory.fundingTime));
  },

  /**
   * 获取最新的费率时间
   */
  async getLatestTime(symbol: string): Promise<Date | null> {
    const db = getDb();
    const [result] = await db
      .select({ maxTime: sql<Date>`MAX(funding_time)` })
      .from(fundingRateHistory)
      .where(eq(fundingRateHistory.symbol, symbol));
    return result?.maxTime ?? null;
  },
};
