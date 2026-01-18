/**
 * REST API 服务器
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import type { SystemContext } from '../index.js';

// 路由处理器
import { registerPositionRoutes } from './routes/positions.js';
import { registerOpportunityRoutes } from './routes/opportunities.js';
import { registerBacktestRoutes } from './routes/backtest.js';
import { registerStatusRoutes } from './routes/status.js';

/**
 * 创建 API 服务器
 */
export function createApiServer(context: SystemContext): FastifyInstance {
  const server = Fastify({
    logger: false, // 使用自定义 logger
  });

  // 注册 CORS
  if (config.api.cors.enabled) {
    server.register(cors, {
      origin: config.api.cors.origin,
    });
  }

  // 请求日志
  server.addHook('onRequest', async (request) => {
    logger.debug(
      { method: request.method, url: request.url },
      'API 请求'
    );
  });

  // 错误处理
  server.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'API 错误');
    reply.status(500).send({
      error: 'Internal Server Error',
      message: error.message,
    });
  });

  // 健康检查
  server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 注册路由
  registerStatusRoutes(server, context);
  registerPositionRoutes(server, context);
  registerOpportunityRoutes(server, context);
  registerBacktestRoutes(server, context);

  return server;
}
