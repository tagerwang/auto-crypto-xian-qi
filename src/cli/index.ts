#!/usr/bin/env node
/**
 * CLI 命令行工具
 * 
 * 使用方式:
 *   npx arbitrage <command> [options]
 * 
 * 命令:
 *   start     - 启动套利系统
 *   stop      - 停止系统
 *   status    - 查看系统状态
 *   positions - 查看持仓
 *   opportunities - 扫描套利机会
 *   backtest  - 运行回测
 */

import { config } from '../config/index.js';
import { initDatabase } from '../db/index.js';
import { BinanceAdapter } from '../adapters/binance/index.js';
import { Scanner } from '../core/scanner.js';
import { DataLoader } from '../backtest/data-loader.js';
import { BacktestEngine } from '../backtest/engine.js';
import { BacktestReporter } from '../backtest/reporter.js';
import { positionRepository, systemStateRepository } from '../db/repository.js';
import { formatCurrency, formatPercent } from '../utils/decimal.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'start':
      console.log('启动套利系统...');
      console.log('请使用: npm run start');
      break;

    case 'status':
      await showStatus();
      break;

    case 'positions':
      await showPositions();
      break;

    case 'opportunities':
    case 'scan':
      await scanOpportunities();
      break;

    case 'backtest':
      await runBacktest();
      break;

    case 'help':
    default:
      showHelp();
  }
}

function showHelp() {
  console.log(`
现期费率套利系统 CLI

使用方式:
  npx arbitrage <command>

可用命令:
  start         启动套利系统
  status        查看系统状态
  positions     查看当前持仓
  opportunities 扫描套利机会
  backtest      运行回测

示例:
  npx arbitrage status
  npx arbitrage positions
  npx arbitrage scan
  npx arbitrage backtest --days 30
`);
}

async function showStatus() {
  await initDatabase();
  
  const state = await systemStateRepository.get();
  const positions = await positionRepository.findActive();
  
  console.log('\n========== 系统状态 ==========\n');
  console.log(`运行状态: ${state?.isRunning ? '运行中' : '已停止'}`);
  console.log(`环境: ${config.exchange.testnet ? '测试网' : '主网'}`);
  console.log(`活跃持仓: ${positions.length} 个`);
  
  if (state?.totalEquity) {
    console.log(`总权益: ${formatCurrency(state.totalEquity)}`);
  }
  if (state?.totalUnrealizedPnl) {
    console.log(`未实现盈亏: ${formatCurrency(state.totalUnrealizedPnl)}`);
  }
  if (state?.lastScanAt) {
    console.log(`上次扫描: ${new Date(state.lastScanAt).toLocaleString()}`);
  }
  
  console.log('');
}

async function showPositions() {
  await initDatabase();
  
  const active = await positionRepository.findActive();
  const history = await positionRepository.findHistory(10);
  
  console.log('\n========== 活跃持仓 ==========\n');
  
  if (active.length === 0) {
    console.log('暂无活跃持仓\n');
  } else {
    for (const p of active) {
      console.log(`[${p.symbol}]`);
      console.log(`  状态: ${p.status}`);
      console.log(`  数量: ${p.spotQuantity}`);
      console.log(`  入场价: ${p.spotEntryPrice}`);
      console.log(`  费率收益: ${formatCurrency(p.totalFundingCollected)}`);
      console.log(`  未实现盈亏: ${formatCurrency(p.unrealizedPnl)}`);
      console.log(`  开仓时间: ${new Date(p.openedAt).toLocaleString()}`);
      console.log('');
    }
  }
  
  console.log('========== 最近平仓 ==========\n');
  
  if (history.length === 0) {
    console.log('暂无历史记录\n');
  } else {
    for (const p of history.slice(0, 5)) {
      console.log(`[${p.symbol}] ${p.closeReason}`);
      console.log(`  已实现盈亏: ${formatCurrency(p.realizedPnl ?? 0)}`);
      console.log(`  持仓时长: ${((new Date(p.closedAt!).getTime() - new Date(p.openedAt).getTime()) / (24 * 60 * 60 * 1000)).toFixed(1)} 天`);
      console.log('');
    }
  }
}

async function scanOpportunities() {
  console.log('\n扫描套利机会中...\n');
  
  const adapter = new BinanceAdapter({
    apiKey: config.exchange.testnet
      ? process.env.BINANCE_TESTNET_API_KEY || ''
      : process.env.BINANCE_API_KEY || '',
    apiSecret: config.exchange.testnet
      ? process.env.BINANCE_TESTNET_API_SECRET || ''
      : process.env.BINANCE_API_SECRET || '',
    testnet: config.exchange.testnet,
  });

  const scanner = new Scanner(adapter, config.strategy.scanner);
  const result = await scanner.scan();

  console.log(`扫描完成: ${result.totalScanned} 个标的, 发现 ${result.passedFilter} 个机会\n`);

  if (result.opportunities.length === 0) {
    console.log('当前没有符合条件的套利机会\n');
    return;
  }

  console.log('========== 套利机会 ==========\n');
  
  for (const opp of result.opportunities.slice(0, 10)) {
    console.log(`[${opp.symbol}]`);
    console.log(`  费率: ${formatPercent(opp.fundingRate)} (${opp.fundingInterval}h)`);
    console.log(`  年化: ${formatPercent(opp.annualizedReturn)}`);
    console.log(`  24h成交量: ${formatCurrency(opp.volume24h)}`);
    console.log(`  价差: ${formatPercent(opp.spreadPct)}`);
    console.log(`  评分: ${opp.overallScore.toFixed(0)}/100`);
    console.log('');
  }
}

async function runBacktest() {
  const daysArg = args.find((a) => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]!, 10) : 30;

  console.log(`\n运行回测 (${days} 天)...\n`);

  const adapter = new BinanceAdapter({
    apiKey: '',
    apiSecret: '',
    testnet: true,
  });

  await initDatabase();

  const dataLoader = new DataLoader(adapter);
  const engine = new BacktestEngine(dataLoader);
  const reporter = new BacktestReporter();

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const backtestConfig = {
    startDate,
    endDate,
    initialCapital: config.backtest.initialCapital,
    commission: config.backtest.commission,
    slippage: config.backtest.slippage,
    signals: config.strategy.signals,
    risk: config.strategy.risk,
  };

  const result = await engine.run(backtestConfig as any);
  
  // 打印报告
  console.log(reporter.generateTextReport(result));
  
  // 保存到数据库
  const reportId = await reporter.generateAndSave(result);
  console.log(`报告已保存, ID: ${reportId}\n`);
}

main().catch((error) => {
  console.error('错误:', error.message);
  process.exit(1);
});
