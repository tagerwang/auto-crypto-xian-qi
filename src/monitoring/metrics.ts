/**
 * 监控指标收集
 */

import { logger } from '../utils/logger.js';
import { Decimal, toDecimal } from '../utils/decimal.js';
import { positionRepository, systemStateRepository } from '../db/repository.js';

export interface SystemMetrics {
  // 系统状态
  uptime: number;
  isRunning: boolean;
  
  // 连接状态
  apiLatency: number;
  wsConnected: boolean;
  dbConnected: boolean;
  
  // 交易指标
  activePositions: number;
  totalEquity: Decimal;
  unrealizedPnL: Decimal;
  totalFundingCollected: Decimal;
  
  // 性能指标
  lastScanDuration: number;
  signalsGenerated: number;
  ordersExecuted: number;
  
  // 风控指标
  drawdown: Decimal;
  marginRatio: Decimal;
  
  timestamp: Date;
}

/**
 * 指标收集器
 */
export class MetricsCollector {
  private startTime: Date = new Date();
  private lastScanDuration: number = 0;
  private signalsGenerated: number = 0;
  private ordersExecuted: number = 0;
  private apiLatency: number = 0;

  /**
   * 收集当前指标
   */
  async collect(): Promise<SystemMetrics> {
    const state = await systemStateRepository.get();
    const positions = await positionRepository.findActive();

    let totalEquity = toDecimal(0);
    let unrealizedPnL = toDecimal(0);
    let totalFundingCollected = toDecimal(0);

    for (const pos of positions) {
      const value = toDecimal(pos.spotQuantity).mul(toDecimal(pos.spotEntryPrice));
      totalEquity = totalEquity.plus(value);
      unrealizedPnL = unrealizedPnL.plus(toDecimal(pos.unrealizedPnl));
      totalFundingCollected = totalFundingCollected.plus(toDecimal(pos.totalFundingCollected));
    }

    return {
      uptime: Date.now() - this.startTime.getTime(),
      isRunning: state?.isRunning ?? false,
      apiLatency: this.apiLatency,
      wsConnected: true, // TODO: 从 adapter 获取
      dbConnected: true,
      activePositions: positions.length,
      totalEquity,
      unrealizedPnL,
      totalFundingCollected,
      lastScanDuration: this.lastScanDuration,
      signalsGenerated: this.signalsGenerated,
      ordersExecuted: this.ordersExecuted,
      drawdown: toDecimal(0), // TODO: 从 RiskManager 获取
      marginRatio: toDecimal(1),
      timestamp: new Date(),
    };
  }

  /**
   * 记录扫描耗时
   */
  recordScanDuration(durationMs: number): void {
    this.lastScanDuration = durationMs;
  }

  /**
   * 记录信号生成
   */
  recordSignalGenerated(count: number = 1): void {
    this.signalsGenerated += count;
  }

  /**
   * 记录订单执行
   */
  recordOrderExecuted(count: number = 1): void {
    this.ordersExecuted += count;
  }

  /**
   * 记录 API 延迟
   */
  recordApiLatency(latencyMs: number): void {
    this.apiLatency = latencyMs;
  }

  /**
   * 重置计数器
   */
  resetCounters(): void {
    this.signalsGenerated = 0;
    this.ordersExecuted = 0;
  }

  /**
   * 导出 Prometheus 格式指标
   */
  async exportPrometheus(): Promise<string> {
    const metrics = await this.collect();
    
    const lines = [
      `# HELP arbitrage_uptime_seconds System uptime in seconds`,
      `# TYPE arbitrage_uptime_seconds gauge`,
      `arbitrage_uptime_seconds ${metrics.uptime / 1000}`,
      '',
      `# HELP arbitrage_active_positions Number of active positions`,
      `# TYPE arbitrage_active_positions gauge`,
      `arbitrage_active_positions ${metrics.activePositions}`,
      '',
      `# HELP arbitrage_total_equity_usdt Total equity in USDT`,
      `# TYPE arbitrage_total_equity_usdt gauge`,
      `arbitrage_total_equity_usdt ${metrics.totalEquity.toString()}`,
      '',
      `# HELP arbitrage_unrealized_pnl_usdt Unrealized PnL in USDT`,
      `# TYPE arbitrage_unrealized_pnl_usdt gauge`,
      `arbitrage_unrealized_pnl_usdt ${metrics.unrealizedPnL.toString()}`,
      '',
      `# HELP arbitrage_funding_collected_usdt Total funding collected in USDT`,
      `# TYPE arbitrage_funding_collected_usdt counter`,
      `arbitrage_funding_collected_usdt ${metrics.totalFundingCollected.toString()}`,
      '',
      `# HELP arbitrage_api_latency_ms API latency in milliseconds`,
      `# TYPE arbitrage_api_latency_ms gauge`,
      `arbitrage_api_latency_ms ${metrics.apiLatency}`,
      '',
      `# HELP arbitrage_signals_generated Total signals generated`,
      `# TYPE arbitrage_signals_generated counter`,
      `arbitrage_signals_generated ${metrics.signalsGenerated}`,
      '',
      `# HELP arbitrage_orders_executed Total orders executed`,
      `# TYPE arbitrage_orders_executed counter`,
      `arbitrage_orders_executed ${metrics.ordersExecuted}`,
    ];

    return lines.join('\n');
  }
}
