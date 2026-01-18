/**
 * 定时任务调度器
 */

import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { toDecimal } from '../utils/decimal.js';
import { Scanner } from '../core/scanner.js';
import { Evaluator } from '../core/evaluator.js';
import { SignalGenerator } from '../core/signal.js';
import { Executor } from '../core/executor.js';
import { PositionManager } from '../core/position.js';
import { RiskManager } from '../risk/manager.js';
import { systemStateRepository } from '../db/repository.js';
import { config } from '../config/index.js';
import type { SystemContext } from '../index.js';

// 存储所有定时任务
const tasks: cron.ScheduledTask[] = [];
const intervals: NodeJS.Timeout[] = [];

/**
 * 启动所有定时任务
 */
export function startSchedulers(context: SystemContext): void {
  logger.info('启动定时任务调度器');

  // 从配置读取扫描间隔（秒），默认 600 秒（10 分钟）
  const scanIntervalSeconds = config.strategy.scanner.scanIntervalSeconds || 600;
  const scanIntervalMs = scanIntervalSeconds * 1000;

  // 1. 市场扫描任务（从配置读取间隔）
  logger.info(`市场扫描间隔: ${scanIntervalSeconds} 秒 (${scanIntervalSeconds / 60} 分钟)`);
  
  // 启动时先执行一次
  setTimeout(() => runMarketScan(context), 5000);
  
  // 然后按配置间隔执行
  const scanInterval = setInterval(async () => {
    await runMarketScan(context);
  }, scanIntervalMs);
  intervals.push(scanInterval);

  // 2. 持仓监控任务（每 30 秒）
  const monitorTask = cron.schedule('*/30 * * * * *', async () => {
    await runPositionMonitor(context);
  });
  tasks.push(monitorTask);

  // 3. 费率结算检查（每分钟）
  const fundingTask = cron.schedule('*/1 * * * *', async () => {
    await runFundingCheck(context);
  });
  tasks.push(fundingTask);

  // 4. 系统状态更新（每分钟）
  const statusTask = cron.schedule('*/1 * * * *', async () => {
    await updateSystemStatus(context);
  });
  tasks.push(statusTask);

  // 5. 账户信息同步（每 5 分钟）
  const accountTask = cron.schedule('*/5 * * * *', async () => {
    await syncAccountInfo(context);
  });
  tasks.push(accountTask);

  logger.info(`已启动 ${tasks.length + intervals.length} 个定时任务`);
}

/**
 * 停止所有定时任务
 */
export function stopSchedulers(): void {
  logger.info('停止定时任务调度器');
  for (const task of tasks) {
    task.stop();
  }
  for (const interval of intervals) {
    clearInterval(interval);
  }
  tasks.length = 0;
  intervals.length = 0;
}

/**
 * 市场扫描任务
 */
async function runMarketScan(context: SystemContext): Promise<void> {
  try {
    logger.debug('执行市场扫描任务');

    // 1. 扫描市场
    const scanResult = await context.scanner.scan();

    if (scanResult.opportunities.length === 0) {
      logger.debug('未发现套利机会');
      return;
    }

    // 2. 评估机会
    const evaluations = await context.evaluator.evaluateMany(scanResult.opportunities);
    const validOpportunities = evaluations
      .filter((e) => e.isValid)
      .map((e) => e.opportunity);

    if (validOpportunities.length === 0) {
      logger.debug('没有通过评估的机会');
      return;
    }

    // 3. 生成开仓信号
    const signals = await context.signalGenerator.generateOpenSignals(validOpportunities);

    if (signals.length === 0) {
      logger.debug('没有生成开仓信号');
      return;
    }

    logger.info({ count: signals.length }, '生成开仓信号');

    // 4. 执行信号
    const results = await context.executor.executeSignals(signals);
    const successCount = results.filter((r) => r.success).length;

    logger.info({ total: signals.length, success: successCount }, '开仓信号执行完成');
  } catch (error) {
    logger.error({ error }, '市场扫描任务失败');
  }
}

/**
 * 持仓监控任务
 */
async function runPositionMonitor(context: SystemContext): Promise<void> {
  try {
    logger.debug('执行持仓监控任务');

    // 1. 更新持仓盈亏
    await context.positionManager.updateAllPositions();

    // 2. 获取当前费率
    const rates = await context.adapter.getFundingRates();
    const ratesMap = new Map(rates.map((r) => [r.symbol, r]));

    // 3. 检查平仓信号
    const closeSignals = await context.signalGenerator.checkAllCloseSignals(ratesMap);

    if (closeSignals.length > 0) {
      logger.info({ count: closeSignals.length }, '生成平仓信号');

      // 4. 执行平仓
      const results = await context.executor.executeSignals(closeSignals);
      const successCount = results.filter((r) => r.success).length;

      logger.info({ total: closeSignals.length, success: successCount }, '平仓信号执行完成');
    }
  } catch (error) {
    logger.error({ error }, '持仓监控任务失败');
  }
}

/**
 * 费率结算检查任务
 */
async function runFundingCheck(context: SystemContext): Promise<void> {
  try {
    const positions = await context.positionManager.getActivePositions();
    if (positions.length === 0) return;

    // 获取当前费率信息
    const symbols = positions.map((p) => p.symbol);
    const rates = await context.adapter.getFundingRates(symbols);

    const now = Date.now();

    for (const position of positions) {
      const rate = rates.find((r) => r.symbol === position.symbol);
      if (!rate) continue;

      // 检查是否刚刚结算（结算后 1 分钟内）
      const timeSinceLastSettlement = now % (position.fundingInterval * 60 * 60 * 1000);
      
      if (timeSinceLastSettlement < 60 * 1000) {
        // 记录结算
        await context.positionManager.recordFundingSettlement(
          position,
          rate,
          rate.markPrice
        );
      }
    }
  } catch (error) {
    logger.error({ error }, '费率结算检查任务失败');
  }
}

/**
 * 更新系统状态
 */
async function updateSystemStatus(context: SystemContext): Promise<void> {
  try {
    const summary = await context.positionManager.getPositionSummary();
    
    await systemStateRepository.update({
      isRunning: true,
      lastScanAt: context.scanner.getLastScanTime() ?? undefined,
      activePositionCount: summary.activeCount,
      totalEquity: summary.totalValue.toString(),
      totalUnrealizedPnl: summary.totalUnrealizedPnL.toString(),
    });
  } catch (error) {
    logger.error({ error }, '更新系统状态失败');
  }
}

/**
 * 同步账户信息
 */
async function syncAccountInfo(context: SystemContext): Promise<void> {
  try {
    const [spotBalances, futuresBalances] = await Promise.all([
      context.adapter.getSpotBalances(),
      context.adapter.getFuturesBalances(),
    ]);

    // 计算总权益
    const spotTotal = spotBalances.reduce(
      (sum, b) => sum.plus(b.total),
      toDecimal(0)
    );
    const futuresEquity = await context.adapter.getFuturesTotalEquity();
    const totalEquity = spotTotal.plus(futuresEquity);

    // 更新风控管理器
    context.riskManager.updateAccountInfo({
      balances: [...spotBalances, ...futuresBalances],
      totalEquity,
      availableBalance: futuresEquity, // 简化处理
    });

    logger.debug(
      { spotTotal: spotTotal.toString(), futuresEquity: futuresEquity.toString() },
      '账户信息已同步'
    );
  } catch (error) {
    logger.error({ error }, '同步账户信息失败');
  }
}

export { runMarketScan, runPositionMonitor, runFundingCheck };
