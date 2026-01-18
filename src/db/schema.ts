/**
 * 数据库 Schema 定义
 * 
 * 使用 Drizzle ORM 定义所有数据表
 */

import {
  mysqlTable,
  varchar,
  text,
  int,
  bigint,
  decimal,
  boolean,
  datetime,
  timestamp,
  json,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';

// ===========================================
// 套利持仓表
// ===========================================

export const positions = mysqlTable('positions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // OPENING | ACTIVE | CLOSING | CLOSED | ERROR
  
  // 现货端
  spotQuantity: decimal('spot_quantity', { precision: 20, scale: 8 }).notNull(),
  spotEntryPrice: decimal('spot_entry_price', { precision: 20, scale: 8 }).notNull(),
  spotExitPrice: decimal('spot_exit_price', { precision: 20, scale: 8 }),
  spotOrderId: varchar('spot_order_id', { length: 50 }),
  spotCloseOrderId: varchar('spot_close_order_id', { length: 50 }),
  
  // 合约端
  futuresQuantity: decimal('futures_quantity', { precision: 20, scale: 8 }).notNull(),
  futuresEntryPrice: decimal('futures_entry_price', { precision: 20, scale: 8 }).notNull(),
  futuresExitPrice: decimal('futures_exit_price', { precision: 20, scale: 8 }),
  futuresOrderId: varchar('futures_order_id', { length: 50 }),
  futuresCloseOrderId: varchar('futures_close_order_id', { length: 50 }),
  
  // 费率相关
  fundingInterval: int('funding_interval').notNull(), // 1 | 4 | 8 小时
  totalFundingCollected: decimal('total_funding_collected', { precision: 20, scale: 8 }).notNull().default('0'),
  fundingRecordCount: int('funding_record_count').notNull().default(0),
  
  // 盈亏
  unrealizedPnl: decimal('unrealized_pnl', { precision: 20, scale: 8 }).notNull().default('0'),
  realizedPnl: decimal('realized_pnl', { precision: 20, scale: 8 }),
  
  // 开仓时的年化收益率
  entryAnnualizedReturn: decimal('entry_annualized_return', { precision: 10, scale: 6 }),
  
  // 平仓原因
  closeReason: varchar('close_reason', { length: 50 }),
  
  // 时间戳
  openedAt: datetime('opened_at').notNull(),
  closedAt: datetime('closed_at'),
  lastUpdatedAt: timestamp('last_updated_at').notNull().defaultNow().onUpdateNow(),
  
  // 元数据
  metadata: json('metadata'),
}, (table) => ({
  symbolIdx: index('idx_symbol').on(table.symbol),
  statusIdx: index('idx_status').on(table.status),
  openedAtIdx: index('idx_opened_at').on(table.openedAt),
}));

// ===========================================
// 费率结算记录表
// ===========================================

export const fundingRecords = mysqlTable('funding_records', {
  id: varchar('id', { length: 36 }).primaryKey(),
  positionId: varchar('position_id', { length: 36 }).notNull(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  
  // 费率信息
  fundingRate: decimal('funding_rate', { precision: 12, scale: 8 }).notNull(),
  fundingInterval: int('funding_interval').notNull(),
  annualizedRate: decimal('annualized_rate', { precision: 10, scale: 6 }).notNull(),
  
  // 结算详情
  scheduledTime: datetime('scheduled_time').notNull(),
  settledAt: datetime('settled_at').notNull(),
  markPriceAtSettlement: decimal('mark_price_at_settlement', { precision: 20, scale: 8 }).notNull(),
  
  // 持仓和收益
  positionSize: decimal('position_size', { precision: 20, scale: 8 }).notNull(),
  positionValueAtSettlement: decimal('position_value_at_settlement', { precision: 20, scale: 8 }).notNull(),
  fundingAmount: decimal('funding_amount', { precision: 20, scale: 8 }).notNull(),
  
  // 元数据
  isEstimated: boolean('is_estimated').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  positionIdIdx: index('idx_position_id').on(table.positionId),
  symbolIdx: index('idx_symbol').on(table.symbol),
  settledAtIdx: index('idx_settled_at').on(table.settledAt),
}));

// ===========================================
// 订单记录表
// ===========================================

export const orders = mysqlTable('orders', {
  id: varchar('id', { length: 36 }).primaryKey(),
  positionId: varchar('position_id', { length: 36 }),
  
  // 订单基本信息
  orderId: varchar('order_id', { length: 50 }).notNull(),
  clientOrderId: varchar('client_order_id', { length: 50 }),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  marketType: varchar('market_type', { length: 10 }).notNull(), // spot | futures
  side: varchar('side', { length: 10 }).notNull(), // BUY | SELL
  orderType: varchar('order_type', { length: 10 }).notNull(), // LIMIT | MARKET
  status: varchar('status', { length: 20 }).notNull(),
  
  // 价格和数量
  price: decimal('price', { precision: 20, scale: 8 }),
  quantity: decimal('quantity', { precision: 20, scale: 8 }).notNull(),
  executedQty: decimal('executed_qty', { precision: 20, scale: 8 }).notNull().default('0'),
  avgPrice: decimal('avg_price', { precision: 20, scale: 8 }),
  
  // 手续费
  commission: decimal('commission', { precision: 20, scale: 8 }),
  commissionAsset: varchar('commission_asset', { length: 10 }),
  
  // 时间戳
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
}, (table) => ({
  orderIdIdx: uniqueIndex('idx_order_id').on(table.orderId, table.marketType),
  positionIdIdx: index('idx_position_id').on(table.positionId),
  symbolIdx: index('idx_symbol').on(table.symbol),
}));

// ===========================================
// 交易信号表
// ===========================================

export const signals = mysqlTable('signals', {
  id: varchar('id', { length: 36 }).primaryKey(),
  type: varchar('type', { length: 10 }).notNull(), // OPEN | CLOSE | ADJUST
  symbol: varchar('symbol', { length: 20 }).notNull(),
  
  // 开仓信号字段
  annualizedReturn: decimal('annualized_return', { precision: 10, scale: 6 }),
  fundingRate: decimal('funding_rate', { precision: 12, scale: 8 }),
  fundingInterval: int('funding_interval'),
  
  // 平仓信号字段
  closeReason: varchar('close_reason', { length: 50 }),
  positionId: varchar('position_id', { length: 36 }),
  
  // 状态
  status: varchar('status', { length: 20 }).notNull().default('PENDING'), // PENDING | EXECUTED | CANCELLED | EXPIRED
  priority: int('priority').notNull().default(0),
  
  // 执行结果
  executedAt: datetime('executed_at'),
  resultPositionId: varchar('result_position_id', { length: 36 }),
  errorMessage: text('error_message'),
  
  // 时间戳
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: datetime('expires_at'),
  
  // 元数据
  metadata: json('metadata'),
}, (table) => ({
  typeIdx: index('idx_type').on(table.type),
  symbolIdx: index('idx_symbol').on(table.symbol),
  statusIdx: index('idx_status').on(table.status),
  createdAtIdx: index('idx_created_at').on(table.createdAt),
}));

// ===========================================
// 回测结果表
// ===========================================

export const backtestResults = mysqlTable('backtest_results', {
  id: varchar('id', { length: 36 }).primaryKey(),
  
  // 配置
  startDate: datetime('start_date').notNull(),
  endDate: datetime('end_date').notNull(),
  initialCapital: decimal('initial_capital', { precision: 20, scale: 2 }).notNull(),
  configJson: json('config_json').notNull(),
  
  // 核心指标
  totalReturn: decimal('total_return', { precision: 10, scale: 6 }).notNull(),
  annualizedReturn: decimal('annualized_return', { precision: 10, scale: 6 }).notNull(),
  sharpeRatio: decimal('sharpe_ratio', { precision: 10, scale: 4 }),
  maxDrawdown: decimal('max_drawdown', { precision: 10, scale: 6 }).notNull(),
  winRate: decimal('win_rate', { precision: 10, scale: 6 }).notNull(),
  profitFactor: decimal('profit_factor', { precision: 10, scale: 4 }),
  
  // 策略特有指标
  totalFundingCollected: decimal('total_funding_collected', { precision: 20, scale: 8 }),
  avgHoldingPeriodDays: decimal('avg_holding_period_days', { precision: 10, scale: 2 }),
  capitalUtilization: decimal('capital_utilization', { precision: 10, scale: 6 }),
  fundingIncomeRatio: decimal('funding_income_ratio', { precision: 10, scale: 6 }),
  
  // 交易统计
  totalTrades: int('total_trades').notNull(),
  winningTrades: int('winning_trades').notNull(),
  losingTrades: int('losing_trades').notNull(),
  
  // 资金曲线（JSON 数组）
  equityCurve: json('equity_curve'),
  
  // 详细交易记录（JSON 数组）
  tradesJson: json('trades_json'),
  
  // 时间戳
  executedAt: timestamp('executed_at').notNull().defaultNow(),
  durationMs: int('duration_ms'),
}, (table) => ({
  executedAtIdx: index('idx_executed_at').on(table.executedAt),
}));

// ===========================================
// 告警记录表
// ===========================================

export const alerts = mysqlTable('alerts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  level: varchar('level', { length: 10 }).notNull(), // CRITICAL | ERROR | WARNING | INFO
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  
  // 关联信息
  positionId: varchar('position_id', { length: 36 }),
  symbol: varchar('symbol', { length: 20 }),
  
  // 通知状态
  sent: boolean('sent').notNull().default(false),
  sentAt: datetime('sent_at'),
  
  // 时间戳
  createdAt: timestamp('created_at').notNull().defaultNow(),
  
  // 元数据
  metadata: json('metadata'),
}, (table) => ({
  levelIdx: index('idx_level').on(table.level),
  createdAtIdx: index('idx_created_at').on(table.createdAt),
}));

// ===========================================
// 系统状态表（单行表，用于持久化系统状态）
// ===========================================

export const systemState = mysqlTable('system_state', {
  id: int('id').primaryKey().default(1),
  isRunning: boolean('is_running').notNull().default(false),
  startedAt: datetime('started_at'),
  lastScanAt: datetime('last_scan_at'),
  totalEquity: decimal('total_equity', { precision: 20, scale: 8 }),
  totalUnrealizedPnl: decimal('total_unrealized_pnl', { precision: 20, scale: 8 }),
  activePositionCount: int('active_position_count').notNull().default(0),
  lastError: text('last_error'),
  lastErrorAt: datetime('last_error_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

// ===========================================
// 历史费率缓存表（用于回测）
// ===========================================

export const fundingRateHistory = mysqlTable('funding_rate_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  fundingRate: decimal('funding_rate', { precision: 12, scale: 8 }).notNull(),
  fundingTime: datetime('funding_time').notNull(),
  markPrice: decimal('mark_price', { precision: 20, scale: 8 }),
  indexPrice: decimal('index_price', { precision: 20, scale: 8 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  symbolTimeIdx: uniqueIndex('idx_symbol_time').on(table.symbol, table.fundingTime),
  symbolIdx: index('idx_symbol').on(table.symbol),
  fundingTimeIdx: index('idx_funding_time').on(table.fundingTime),
}));

// 导出类型
export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;

export type FundingRecord = typeof fundingRecords.$inferSelect;
export type NewFundingRecord = typeof fundingRecords.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

export type BacktestResult = typeof backtestResults.$inferSelect;
export type NewBacktestResult = typeof backtestResults.$inferInsert;

export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;

export type SystemState = typeof systemState.$inferSelect;

export type FundingRateHistoryRecord = typeof fundingRateHistory.$inferSelect;
export type NewFundingRateHistoryRecord = typeof fundingRateHistory.$inferInsert;
