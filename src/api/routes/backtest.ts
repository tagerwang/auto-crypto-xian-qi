/**
 * 回测路由
 */

import { FastifyInstance } from 'fastify';
import type { SystemContext } from '../../index.js';
import { DataLoader } from '../../backtest/data-loader.js';
import { BacktestEngine } from '../../backtest/engine.js';
import { BacktestReporter } from '../../backtest/reporter.js';
import { backtestRepository } from '../../db/repository.js';

export function registerBacktestRoutes(
  server: FastifyInstance,
  context: SystemContext
): void {
  // 运行回测
  server.post('/api/v1/backtest', async (request, reply) => {
    const body = request.body as {
      startDate: string;
      endDate: string;
      initialCapital?: number;
      symbols?: string[];
    };

    if (!body.startDate || !body.endDate) {
      return reply.status(400).send({ error: '缺少必要参数: startDate, endDate' });
    }

    const config = {
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      initialCapital: body.initialCapital ?? context.config.backtest.initialCapital,
      symbols: body.symbols,
      commission: context.config.backtest.commission,
      slippage: context.config.backtest.slippage,
      signals: context.config.strategy.signals,
      risk: context.config.strategy.risk,
    };

    // 创建回测引擎
    const dataLoader = new DataLoader(context.adapter);
    const engine = new BacktestEngine(dataLoader);
    const reporter = new BacktestReporter();

    // 运行回测
    const result = await engine.run(config as any);

    // 保存结果
    const reportId = await reporter.generateAndSave(result);

    return {
      id: reportId,
      summary: {
        totalReturn: (result.totalReturn * 100).toFixed(2) + '%',
        annualizedReturn: (result.annualizedReturn * 100).toFixed(2) + '%',
        sharpeRatio: result.sharpeRatio.toFixed(2),
        maxDrawdown: (result.maxDrawdown * 100).toFixed(2) + '%',
        winRate: (result.winRate * 100).toFixed(2) + '%',
        totalTrades: result.totalTrades,
      },
      durationMs: result.durationMs,
    };
  });

  // 获取回测历史
  server.get('/api/v1/backtest', async () => {
    const results = await backtestRepository.findHistory(20);

    return {
      count: results.length,
      results: results.map((r) => ({
        id: r.id,
        startDate: r.startDate,
        endDate: r.endDate,
        initialCapital: r.initialCapital,
        totalReturn: r.totalReturn,
        annualizedReturn: r.annualizedReturn,
        maxDrawdown: r.maxDrawdown,
        totalTrades: r.totalTrades,
        executedAt: r.executedAt,
      })),
    };
  });

  // 获取回测详情
  server.get('/api/v1/backtest/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await backtestRepository.findById(id);

    if (!result) {
      return reply.status(404).send({ error: '回测结果不存在' });
    }

    return {
      id: result.id,
      config: result.configJson,
      metrics: {
        totalReturn: result.totalReturn,
        annualizedReturn: result.annualizedReturn,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        totalFundingCollected: result.totalFundingCollected,
        avgHoldingPeriodDays: result.avgHoldingPeriodDays,
        capitalUtilization: result.capitalUtilization,
        fundingIncomeRatio: result.fundingIncomeRatio,
      },
      trades: {
        total: result.totalTrades,
        winning: result.winningTrades,
        losing: result.losingTrades,
      },
      equityCurve: result.equityCurve,
      executedAt: result.executedAt,
      durationMs: result.durationMs,
    };
  });
}
