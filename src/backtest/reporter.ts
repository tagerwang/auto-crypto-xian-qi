/**
 * 回测报告生成器
 */

import { BacktestResult } from '../types/index.js';
import { formatPercent, formatCurrency } from '../utils/decimal.js';
import { backtestRepository } from '../db/repository.js';

/**
 * 报告生成器
 */
export class BacktestReporter {
  /**
   * 生成并保存报告
   */
  async generateAndSave(result: BacktestResult): Promise<string> {
    // 保存到数据库
    const saved = await backtestRepository.create({
      startDate: result.config.startDate,
      endDate: result.config.endDate,
      initialCapital: result.config.initialCapital.toString(),
      configJson: JSON.stringify(result.config),
      totalReturn: result.totalReturn.toString(),
      annualizedReturn: result.annualizedReturn.toString(),
      sharpeRatio: result.sharpeRatio.toString(),
      maxDrawdown: result.maxDrawdown.toString(),
      winRate: result.winRate.toString(),
      profitFactor: result.profitFactor?.toString(),
      totalFundingCollected: result.totalFundingCollected.toString(),
      avgHoldingPeriodDays: result.avgHoldingPeriodDays.toString(),
      capitalUtilization: result.capitalUtilization.toString(),
      fundingIncomeRatio: result.fundingIncomeRatio.toString(),
      totalTrades: result.totalTrades,
      winningTrades: result.winningTrades,
      losingTrades: result.losingTrades,
      equityCurve: JSON.stringify(result.equityCurve),
      durationMs: result.durationMs,
    });

    return saved.id;
  }

  /**
   * 生成文本报告
   */
  generateTextReport(result: BacktestResult): string {
    const lines: string[] = [
      '=' .repeat(60),
      '                     回测报告',
      '=' .repeat(60),
      '',
      '【回测配置】',
      `  起始日期: ${result.config.startDate.toLocaleDateString()}`,
      `  结束日期: ${result.config.endDate.toLocaleDateString()}`,
      `  初始资金: ${formatCurrency(result.config.initialCapital)}`,
      `  回测标的: ${result.config.symbols?.length ?? '全部'} 个`,
      '',
      '【核心指标】',
      `  总收益率: ${formatPercent(result.totalReturn)}`,
      `  年化收益: ${formatPercent(result.annualizedReturn)}`,
      `  夏普比率: ${result.sharpeRatio.toFixed(2)}`,
      `  最大回撤: ${formatPercent(result.maxDrawdown)}`,
      `  胜率:     ${formatPercent(result.winRate)}`,
      `  盈亏比:   ${result.profitFactor.toFixed(2)}`,
      '',
      '【交易统计】',
      `  总交易次数: ${result.totalTrades}`,
      `  盈利次数:   ${result.winningTrades}`,
      `  亏损次数:   ${result.losingTrades}`,
      `  平均收益:   ${formatPercent(result.avgTradeReturn)}`,
      '',
      '【策略指标】',
      `  费率收益:     ${formatCurrency(result.totalFundingCollected)}`,
      `  平均持仓天数: ${result.avgHoldingPeriodDays.toFixed(1)} 天`,
      `  资金利用率:   ${formatPercent(result.capitalUtilization)}`,
      `  费率收益占比: ${formatPercent(result.fundingIncomeRatio)}`,
      '',
      '【执行信息】',
      `  执行时间: ${result.executedAt.toLocaleString()}`,
      `  耗时:     ${(result.durationMs / 1000).toFixed(2)} 秒`,
      '',
      '=' .repeat(60),
    ];

    return lines.join('\n');
  }

  /**
   * 生成 JSON 报告
   */
  generateJsonReport(result: BacktestResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * 生成 Markdown 报告
   */
  generateMarkdownReport(result: BacktestResult): string {
    return `# 回测报告

## 回测配置

| 参数 | 值 |
|------|-----|
| 起始日期 | ${result.config.startDate.toLocaleDateString()} |
| 结束日期 | ${result.config.endDate.toLocaleDateString()} |
| 初始资金 | ${formatCurrency(result.config.initialCapital)} |

## 核心指标

| 指标 | 值 |
|------|-----|
| 总收益率 | ${formatPercent(result.totalReturn)} |
| 年化收益 | ${formatPercent(result.annualizedReturn)} |
| 夏普比率 | ${result.sharpeRatio.toFixed(2)} |
| 最大回撤 | ${formatPercent(result.maxDrawdown)} |
| 胜率 | ${formatPercent(result.winRate)} |
| 盈亏比 | ${result.profitFactor.toFixed(2)} |

## 交易统计

| 统计项 | 值 |
|--------|-----|
| 总交易次数 | ${result.totalTrades} |
| 盈利次数 | ${result.winningTrades} |
| 亏损次数 | ${result.losingTrades} |
| 平均收益 | ${formatPercent(result.avgTradeReturn)} |

## 策略指标

| 指标 | 值 |
|------|-----|
| 累计费率收益 | ${formatCurrency(result.totalFundingCollected)} |
| 平均持仓天数 | ${result.avgHoldingPeriodDays.toFixed(1)} 天 |
| 资金利用率 | ${formatPercent(result.capitalUtilization)} |
| 费率收益占比 | ${formatPercent(result.fundingIncomeRatio)} |

---
*报告生成时间: ${result.executedAt.toLocaleString()}*
`;
  }
}
