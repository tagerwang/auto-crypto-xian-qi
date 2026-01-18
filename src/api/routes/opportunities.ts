/**
 * 套利机会路由
 */

import { FastifyInstance } from 'fastify';
import type { SystemContext } from '../../index.js';

export function registerOpportunityRoutes(
  server: FastifyInstance,
  context: SystemContext
): void {
  // 获取当前套利机会
  server.get('/api/v1/opportunities', async () => {
    // 执行扫描
    const scanResult = await context.scanner.scan();

    // 评估机会
    const evaluations = await context.evaluator.evaluateMany(scanResult.opportunities);

    return {
      timestamp: scanResult.timestamp.toISOString(),
      totalScanned: scanResult.totalScanned,
      opportunities: evaluations.map((e) => ({
        symbol: e.opportunity.symbol,
        fundingRate: e.opportunity.fundingRate.toString(),
        fundingInterval: e.opportunity.fundingInterval,
        annualizedReturn: e.opportunity.annualizedReturn.toString(),
        volume24h: e.opportunity.volume24h.toString(),
        spreadPct: e.opportunity.spreadPct.toString(),
        overallScore: e.opportunity.overallScore,
        isValid: e.isValid,
        reasons: e.reasons,
        riskScore: e.details.riskScore,
      })),
    };
  });

  // 获取指定标的的详细信息
  server.get('/api/v1/opportunities/:symbol', async (request, reply) => {
    const { symbol } = request.params as { symbol: string };

    // 获取费率信息
    const rate = await context.scanner.getFundingRate(symbol);
    if (!rate) {
      return reply.status(404).send({ error: '未找到该标的' });
    }

    // 获取价格信息
    const [spotBook, futuresBook] = await Promise.all([
      context.adapter.getOrderBook(symbol, 'spot' as any),
      context.adapter.getOrderBook(symbol, 'futures' as any),
    ]);

    return {
      symbol,
      fundingRate: rate.fundingRate.toString(),
      fundingInterval: rate.fundingInterval,
      nextFundingTime: rate.nextFundingTime.toISOString(),
      markPrice: rate.markPrice.toString(),
      indexPrice: rate.indexPrice.toString(),
      spot: {
        bestBid: spotBook.bids[0]?.[0].toString(),
        bestAsk: spotBook.asks[0]?.[0].toString(),
      },
      futures: {
        bestBid: futuresBook.bids[0]?.[0].toString(),
        bestAsk: futuresBook.asks[0]?.[0].toString(),
      },
    };
  });
}
