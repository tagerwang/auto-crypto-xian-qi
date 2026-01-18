/**
 * 系统状态路由
 */

import { FastifyInstance } from 'fastify';
import type { SystemContext } from '../../index.js';
import { systemStateRepository } from '../../db/repository.js';

export function registerStatusRoutes(
  server: FastifyInstance,
  context: SystemContext
): void {
  // 获取系统状态
  server.get('/api/v1/status', async () => {
    const state = await systemStateRepository.get();
    const riskStatus = context.riskManager.getStatus();

    return {
      isRunning: state?.isRunning ?? false,
      startedAt: state?.startedAt,
      lastScanAt: state?.lastScanAt,
      activePositions: state?.activePositionCount ?? 0,
      totalEquity: state?.totalEquity,
      unrealizedPnL: state?.totalUnrealizedPnl,
      risk: {
        isEmergencyStop: riskStatus.isEmergencyStop,
        currentEquity: riskStatus.currentEquity.toString(),
        peakEquity: riskStatus.peakEquity.toString(),
        drawdown: riskStatus.drawdown.toString(),
      },
      wsConnected: context.adapter.isWsConnected(),
      timestamp: new Date().toISOString(),
    };
  });

  // 获取配置
  server.get('/api/v1/config', async () => {
    return {
      exchange: {
        name: context.config.exchange.name,
        testnet: context.config.exchange.testnet,
      },
      strategy: {
        scanner: context.config.strategy.scanner,
        signals: context.config.strategy.signals,
        risk: context.config.strategy.risk,
      },
    };
  });

  // 获取收益指标
  server.get('/api/v1/metrics', async () => {
    const summary = await context.positionManager.getPositionSummary();
    const historical = await context.positionManager.getHistoricalStats();

    return {
      current: {
        activePositions: summary.activeCount,
        totalValue: summary.totalValue.toString(),
        unrealizedPnL: summary.totalUnrealizedPnL.toString(),
        fundingCollected: summary.totalFundingCollected.toString(),
      },
      historical: {
        totalTrades: historical.totalTrades,
        winRate: historical.totalTrades > 0
          ? (historical.winningTrades / historical.totalTrades * 100).toFixed(2) + '%'
          : '0%',
        totalRealizedPnL: historical.totalRealizedPnL.toString(),
        avgHoldingDays: historical.avgHoldingDays.toFixed(1),
        avgReturn: historical.avgReturn.toString(),
      },
    };
  });

  // 重置紧急停止
  server.post('/api/v1/reset-emergency', async () => {
    context.riskManager.resetEmergencyStop();
    return { success: true, message: '紧急停止状态已重置' };
  });
}
