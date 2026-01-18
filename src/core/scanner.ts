/**
 * 市场扫描器
 * 
 * 功能：
 * - 获取所有合约的资金费率
 * - 计算年化收益率（适配不同结算周期）
 * - 筛选符合条件的标的
 * - 检查历史费率稳定性
 */

import { BinanceAdapter } from '../adapters/binance/index.js';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal, annualizedReturn } from '../utils/decimal.js';
import { ScannerConfig } from '../config/schema.js';
import { FundingRateInfo, Opportunity, MarketType } from '../types/index.js';
import { fundingRateHistoryRepository } from '../db/repository.js';

/** 延迟函数，用于限频控制 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** API 请求间隔（毫秒），避免触发限频 */
const API_REQUEST_INTERVAL = 100;

export interface ScanResult {
  opportunities: Opportunity[];
  totalScanned: number;
  passedFilter: number;
  timestamp: Date;
}

/**
 * 市场扫描器
 */
export class Scanner {
  private lastScanTime: Date | null = null;
  private cachedRates: FundingRateInfo[] = [];

  constructor(
    private readonly adapter: BinanceAdapter,
    private readonly config: ScannerConfig
  ) {}

  /**
   * 执行市场扫描
   */
  async scan(): Promise<ScanResult> {
    const startTime = Date.now();
    logger.info('开始市场扫描...');

    try {
      // 1. 获取所有合约费率
      const fundingRates = await this.adapter.getFundingRates();
      this.cachedRates = fundingRates;
      logger.debug({ count: fundingRates.length }, '获取到费率数据');

      // 2. 初步筛选（年化收益 >= 阈值）
      const candidates = this.filterByAnnualizedReturn(fundingRates);
      logger.debug({ count: candidates.length }, '通过年化收益筛选');

      // 3. 检查流动性
      const liquidCandidates = await this.filterByLiquidity(candidates);
      logger.debug({ count: liquidCandidates.length }, '通过流动性筛选');

      // 4. 检查历史稳定性
      const stableCandidates = await this.filterByStability(liquidCandidates);
      logger.debug({ count: stableCandidates.length }, '通过稳定性筛选');

      // 5. 转换为机会对象
      const opportunities = await this.convertToOpportunities(stableCandidates);

      this.lastScanTime = new Date();
      const duration = Date.now() - startTime;

      logger.info(
        {
          totalScanned: fundingRates.length,
          passedFilter: opportunities.length,
          durationMs: duration,
        },
        '市场扫描完成'
      );

      return {
        opportunities,
        totalScanned: fundingRates.length,
        passedFilter: opportunities.length,
        timestamp: this.lastScanTime,
      };
    } catch (error) {
      logger.error({ error }, '市场扫描失败');
      throw error;
    }
  }

  /**
   * 根据年化收益筛选
   */
  private filterByAnnualizedReturn(rates: FundingRateInfo[]): FundingRateInfo[] {
    const minReturn = toDecimal(this.config.minAnnualizedReturn);

    return rates.filter((rate) => {
      // 只关注正费率
      if (rate.fundingRate.lte(0)) {
        return false;
      }

      // 计算年化收益率
      const annualized = annualizedReturn(rate.fundingRate, rate.fundingInterval);
      return annualized.gte(minReturn);
    });
  }

  /**
   * 根据流动性筛选
   */
  private async filterByLiquidity(rates: FundingRateInfo[]): Promise<FundingRateInfo[]> {
    console.log('filterByLiquidity :>> ', rates);
    const minVolume = toDecimal(this.config.min24hVolume);
    const result: FundingRateInfo[] = [];

    // 串行检查流动性，每次请求后等待一段时间避免限频
    for (const rate of rates) {
      try {
        // 检查合约成交量
        const futuresVolume = await this.adapter.get24hVolume(rate.symbol, MarketType.FUTURES);
        await sleep(API_REQUEST_INTERVAL);
        
        // 检查现货成交量
        const spotVolume = await this.adapter.get24hVolume(rate.symbol, MarketType.SPOT);
        await sleep(API_REQUEST_INTERVAL);

        if (futuresVolume.gte(minVolume) && spotVolume.gte(minVolume)) {
          result.push(rate);
        }
      } catch (error) {
        // 可能不存在对应的现货交易对
        logger.debug({ symbol: rate.symbol }, '获取成交量失败，跳过');
      }
    }

    return result;
  }

  /**
   * 根据历史稳定性筛选
   */
  private async filterByStability(rates: FundingRateInfo[]): Promise<FundingRateInfo[]> {
    console.log('filterByStability rates:>> ', rates);
    const windowHours = this.config.stabilityWindowHours;
    const minPositiveRatio = this.config.minPositiveRatio;
    const result: FundingRateInfo[] = [];

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - windowHours * 60 * 60 * 1000);

    for (const rate of rates) {
      try {
        // 获取历史费率
        const history = await this.adapter.getFundingRateHistory(
          rate.symbol,
          startTime,
          endTime
        );
        
        // 请求间隔，避免限频
        await sleep(API_REQUEST_INTERVAL);

        if (history.length === 0) {
          // 没有历史数据，跳过
          continue;
        }

        // 计算正费率比例
        const positiveCount = history.filter((h) => h.fundingRate.gt(0)).length;
        const ratio = positiveCount / history.length;

        if (ratio >= minPositiveRatio) {
          // 检查是否有连续下降趋势
          const hasDeclineTrend = this.checkDeclineTrend(history.slice(-3));
          
          if (!hasDeclineTrend) {
            result.push(rate);
          } else {
            logger.debug(
              { symbol: rate.symbol },
              '费率存在下降趋势，跳过'
            );
          }
        } else {
          logger.debug(
            { symbol: rate.symbol, ratio, minPositiveRatio },
            '费率稳定性不足，跳过'
          );
        }
      } catch (error) {
        logger.debug({ symbol: rate.symbol, error }, '获取历史费率失败，跳过');
      }
    }

    return result;
  }

  /**
   * 检查是否有连续下降趋势
   */
  private checkDeclineTrend(recentRates: FundingRateInfo[]): boolean {
    if (recentRates.length < 3) {
      return false;
    }

    // 检查最近 3 次费率是否连续下降
    for (let i = 1; i < recentRates.length; i++) {
      const prev = recentRates[i - 1];
      const current = recentRates[i];
      if (prev && current && !current.fundingRate.lt(prev.fundingRate)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 转换为机会对象
   */
  private async convertToOpportunities(rates: FundingRateInfo[]): Promise<Opportunity[]> {
    const opportunities: Opportunity[] = [];

    for (const rate of rates) {
      try {
        // 获取价差信息
        const [spotBook, futuresBook] = await Promise.all([
          this.adapter.getOrderBook(rate.symbol, MarketType.SPOT),
          this.adapter.getOrderBook(rate.symbol, MarketType.FUTURES),
        ]);

        // 计算价差（现货买价 vs 合约卖价）
        const spotAsk = spotBook.asks[0]?.[0] ?? toDecimal(0);
        const futuresBid = futuresBook.bids[0]?.[0] ?? toDecimal(0);
        
        const spreadPct = spotAsk.isZero()
          ? toDecimal(0)
          : futuresBid.minus(spotAsk).div(spotAsk).abs();

        // 检查价差是否在阈值内
        if (spreadPct.gt(this.config.maxSpreadPct)) {
          logger.debug(
            { symbol: rate.symbol, spreadPct: spreadPct.toNumber() },
            '价差过大，跳过'
          );
          continue;
        }

        // 获取成交量
        const volume24h = await this.adapter.get24hVolume(rate.symbol, MarketType.FUTURES);

        // 计算各项评分
        const annualized = annualizedReturn(rate.fundingRate, rate.fundingInterval);
        const liquidityScore = this.calculateLiquidityScore(volume24h);
        const stabilityScore = 80; // 已通过稳定性检查，给 80 分

        // 计算综合评分
        const overallScore = this.calculateOverallScore({
          annualizedReturn: annualized.toNumber(),
          liquidityScore,
          stabilityScore,
          spreadPct: spreadPct.toNumber(),
        });

        opportunities.push({
          id: `${rate.symbol}-${Date.now()}`,
          symbol: rate.symbol,
          fundingRate: rate.fundingRate,
          fundingInterval: rate.fundingInterval,
          annualizedReturn: annualized,
          volume24h,
          spreadPct,
          stabilityScore,
          liquidityScore,
          overallScore,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.debug({ symbol: rate.symbol, error }, '转换机会对象失败');
      }
    }

    // 按综合评分排序
    return opportunities.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * 计算流动性评分 (0-100)
   */
  private calculateLiquidityScore(volume24h: Decimal): number {
    // 假设 $100M 为满分
    const maxVolume = 100_000_000;
    const score = volume24h.toNumber() / maxVolume * 100;
    return Math.min(100, Math.max(0, score));
  }

  /**
   * 计算综合评分 (0-100)
   */
  private calculateOverallScore(params: {
    annualizedReturn: number;
    liquidityScore: number;
    stabilityScore: number;
    spreadPct: number;
  }): number {
    // 权重配置
    const weights = {
      return: 0.4,      // 年化收益 40%
      liquidity: 0.3,   // 流动性 30%
      stability: 0.2,   // 稳定性 20%
      spread: 0.1,      // 价差 10%
    };

    // 年化收益评分（假设 100% 年化为满分）
    const returnScore = Math.min(100, params.annualizedReturn * 100);

    // 价差评分（价差越小越好）
    const spreadScore = Math.max(0, 100 - params.spreadPct * 10000);

    return (
      returnScore * weights.return +
      params.liquidityScore * weights.liquidity +
      params.stabilityScore * weights.stability +
      spreadScore * weights.spread
    );
  }

  /**
   * 获取缓存的费率数据
   */
  getCachedRates(): FundingRateInfo[] {
    return this.cachedRates;
  }

  /**
   * 获取上次扫描时间
   */
  getLastScanTime(): Date | null {
    return this.lastScanTime;
  }

  /**
   * 获取指定 symbol 的费率
   */
  async getFundingRate(symbol: string): Promise<FundingRateInfo | null> {
    const rates = await this.adapter.getFundingRates([symbol]);
    return rates[0] ?? null;
  }
}
