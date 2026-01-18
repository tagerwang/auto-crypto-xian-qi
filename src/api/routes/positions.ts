/**
 * 持仓路由
 */

import { FastifyInstance } from 'fastify';
import type { SystemContext } from '../../index.js';
import { positionRepository } from '../../db/repository.js';

export function registerPositionRoutes(
  server: FastifyInstance,
  context: SystemContext
): void {
  // 获取所有持仓
  server.get('/api/v1/positions', async (request) => {
    const query = request.query as { status?: string };
    
    let positions;
    if (query.status === 'active') {
      positions = await positionRepository.findActive();
    } else if (query.status === 'closed') {
      positions = await positionRepository.findHistory(100);
    } else {
      const active = await positionRepository.findActive();
      const closed = await positionRepository.findHistory(20);
      positions = [...active, ...closed];
    }

    return {
      count: positions.length,
      positions: positions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        status: p.status,
        spotQuantity: p.spotQuantity,
        spotEntryPrice: p.spotEntryPrice,
        spotExitPrice: p.spotExitPrice,
        futuresQuantity: p.futuresQuantity,
        futuresEntryPrice: p.futuresEntryPrice,
        futuresExitPrice: p.futuresExitPrice,
        fundingInterval: p.fundingInterval,
        totalFundingCollected: p.totalFundingCollected,
        fundingRecordCount: p.fundingRecordCount,
        unrealizedPnl: p.unrealizedPnl,
        realizedPnl: p.realizedPnl,
        closeReason: p.closeReason,
        openedAt: p.openedAt,
        closedAt: p.closedAt,
      })),
    };
  });

  // 获取持仓详情
  server.get('/api/v1/positions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const position = await positionRepository.findById(id);

    if (!position) {
      return reply.status(404).send({ error: '持仓不存在' });
    }

    // 获取费率记录
    const fundingRecords = await context.positionManager.getFundingRecords(id);

    return {
      position: {
        id: position.id,
        symbol: position.symbol,
        status: position.status,
        spotQuantity: position.spotQuantity,
        spotEntryPrice: position.spotEntryPrice,
        spotExitPrice: position.spotExitPrice,
        futuresQuantity: position.futuresQuantity,
        futuresEntryPrice: position.futuresEntryPrice,
        futuresExitPrice: position.futuresExitPrice,
        fundingInterval: position.fundingInterval,
        totalFundingCollected: position.totalFundingCollected,
        fundingRecordCount: position.fundingRecordCount,
        unrealizedPnl: position.unrealizedPnl,
        realizedPnl: position.realizedPnl,
        entryAnnualizedReturn: position.entryAnnualizedReturn,
        closeReason: position.closeReason,
        openedAt: position.openedAt,
        closedAt: position.closedAt,
      },
      fundingRecords: fundingRecords.map((r) => ({
        id: r.id,
        fundingRate: r.fundingRate,
        annualizedRate: r.annualizedRate,
        fundingAmount: r.fundingAmount,
        settledAt: r.settledAt,
      })),
    };
  });

  // 手动平仓
  server.post('/api/v1/positions/:id/close', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const signal = await context.signalGenerator.generateManualCloseSignal(id);
    if (!signal) {
      return reply.status(400).send({ error: '无法生成平仓信号' });
    }

    const result = await context.executor.executeSignal(signal);
    
    if (!result.success) {
      return reply.status(500).send({ error: result.error });
    }

    return {
      success: true,
      message: '平仓成功',
      positionId: id,
    };
  });
}
