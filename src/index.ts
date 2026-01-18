/**
 * 现期费率套利系统 - 主入口
 */

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initDatabase } from './db/index.js';
import { createApiServer } from './api/server.js';
import { BinanceAdapter } from './adapters/binance/index.js';
import { Scanner } from './core/scanner.js';
import { Evaluator } from './core/evaluator.js';
import { SignalGenerator } from './core/signal.js';
import { Executor } from './core/executor.js';
import { PositionManager } from './core/position.js';
import { RiskManager } from './risk/manager.js';
import { Alerter } from './monitoring/alerter.js';
import { startSchedulers, stopSchedulers } from './scheduler/index.js';

/** 系统上下文 */
export interface SystemContext {
  config: typeof config;
  adapter: BinanceAdapter;
  scanner: Scanner;
  evaluator: Evaluator;
  signalGenerator: SignalGenerator;
  executor: Executor;
  positionManager: PositionManager;
  riskManager: RiskManager;
  alerter: Alerter;
}

let context: SystemContext | null = null;
let isShuttingDown = false;

/**
 * 初始化系统
 */
async function initialize(): Promise<SystemContext> {
  logger.info('正在初始化系统...');

  // 初始化数据库
  await initDatabase();
  logger.info('数据库连接成功');

  // 初始化币安适配器
  const adapter = new BinanceAdapter({
    apiKey: config.exchange.testnet
      ? process.env.BINANCE_TESTNET_API_KEY || ''
      : process.env.BINANCE_API_KEY || '',
    apiSecret: config.exchange.testnet
      ? process.env.BINANCE_TESTNET_API_SECRET || ''
      : process.env.BINANCE_API_SECRET || '',
    testnet: config.exchange.testnet,
  });
  
  // 加载现货交易对列表（用于过滤只有合约没有现货的 symbol）
  await adapter.loadSpotSymbols();

  // 初始化告警器
  const alerter = new Alerter(process.env.ALERT_WEBHOOK_URL);

  // 初始化风控管理器
  const riskManager = new RiskManager(config.strategy.risk, alerter);

  // 初始化持仓管理器
  const positionManager = new PositionManager(adapter, riskManager);

  // 初始化订单执行器
  const executor = new Executor(adapter, config.strategy.execution, positionManager);

  // 初始化市场扫描器
  const scanner = new Scanner(adapter, config.strategy.scanner);

  // 初始化机会评估器
  const evaluator = new Evaluator(adapter, config.strategy);

  // 初始化信号生成器
  const signalGenerator = new SignalGenerator(
    config.strategy.signals,
    riskManager,
    positionManager
  );

  return {
    config,
    adapter,
    scanner,
    evaluator,
    signalGenerator,
    executor,
    positionManager,
    riskManager,
    alerter,
  };
}

/**
 * 启动系统
 */
async function start(): Promise<void> {
  try {
    logger.info('='.repeat(50));
    logger.info('现期费率套利系统启动中...');
    logger.info(`环境: ${config.exchange.testnet ? '测试网' : '主网'}`);
    logger.info('='.repeat(50));

    // 初始化
    context = await initialize();

    // 启动 API 服务
    if (config.api.enabled) {
      const server = createApiServer(context);
      await server.listen({ 
        port: config.api.port, 
        host: config.api.host 
      });
      logger.info(`API 服务已启动: http://${config.api.host}:${config.api.port}`);
    }

    // 启动定时任务
    startSchedulers(context);
    logger.info('定时任务已启动');

    // 连接 WebSocket
    await context.adapter.connectWebSocket();
    logger.info('WebSocket 已连接');

    logger.info('='.repeat(50));
    logger.info('系统启动完成，开始监控市场...');
    logger.info('='.repeat(50));

    // 发送启动通知
    await context.alerter.sendInfo('系统启动', '现期费率套利系统已成功启动');

  } catch (error) {
    logger.error({ error }, '系统启动失败');
    process.exit(1);
  }
}

/**
 * 优雅关闭
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('正在关闭中，请稍候...');
    return;
  }

  isShuttingDown = true;
  logger.info(`收到 ${signal} 信号，正在优雅关闭...`);

  try {
    // 停止定时任务
    stopSchedulers();
    logger.info('定时任务已停止');

    // 断开 WebSocket
    if (context?.adapter) {
      context.adapter.disconnectWebSocket();
      logger.info('WebSocket 已断开');
    }

    // 发送关闭通知
    if (context?.alerter) {
      await context.alerter.sendInfo('系统关闭', '现期费率套利系统正在关闭');
    }

    logger.info('系统已安全关闭');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, '关闭过程中发生错误');
    process.exit(1);
  }
}

// 注册信号处理
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 未捕获的异常处理
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, '未捕获的异常');
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, '未处理的 Promise 拒绝');
  shutdown('unhandledRejection');
});

// 启动系统
start();
