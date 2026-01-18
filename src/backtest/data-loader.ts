/**
 * 回测数据加载器
 * 
 * 功能：
 * - 从币安 API 加载历史费率数据
 * - 数据缓存到数据库
 * - 增量更新
 */

import { BinanceAdapter } from '../adapters/binance/index.js';
import { logger } from '../utils/logger.js';
import { Decimal, toDecimal } from '../utils/decimal.js';
import { fundingRateHistoryRepository } from '../db/repository.js';
import { FundingRateInfo } from '../types/index.js';

export interface HistoricalData {
  fundingRates: Map<string, FundingRateInfo[]>;
  startTime: Date;
  endTime: Date;
  symbols: string[];
}

/**
 * 数据加载器
 */
export class DataLoader {
  constructor(private readonly adapter: BinanceAdapter) {}

  /**
   * 加载历史数据
   */
  async loadHistoricalData(
    symbols: string[],
    startTime: Date,
    endTime: Date
  ): Promise<HistoricalData> {
    logger.info(
      {
        symbols: symbols.length,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      '开始加载历史数据'
    );

    const fundingRates = new Map<string, FundingRateInfo[]>();

    for (const symbol of symbols) {
      try {
        // 先从缓存加载
        const cached = await this.loadFromCache(symbol, startTime, endTime);
        
        if (cached.length > 0) {
          fundingRates.set(symbol, cached);
          logger.debug({ symbol, count: cached.length }, '从缓存加载费率数据');
        } else {
          // 从 API 加载并缓存
          const rates = await this.fetchAndCache(symbol, startTime, endTime);
          fundingRates.set(symbol, rates);
          logger.debug({ symbol, count: rates.length }, '从 API 加载费率数据');
        }
      } catch (error) {
        logger.warn({ symbol, error }, '加载历史数据失败');
      }
    }

    logger.info({ symbolCount: fundingRates.size }, '历史数据加载完成');

    return {
      fundingRates,
      startTime,
      endTime,
      symbols: Array.from(fundingRates.keys()),
    };
  }

  /**
   * 从缓存加载
   */
  private async loadFromCache(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<FundingRateInfo[]> {
    const records = await fundingRateHistoryRepository.findBySymbol(
      symbol,
      startTime,
      endTime
    );

    return records.map((r) => ({
      symbol: r.symbol,
      fundingRate: toDecimal(r.fundingRate),
      fundingInterval: 8, // 历史数据默认 8h
      nextFundingTime: new Date(r.fundingTime),
      markPrice: r.markPrice ? toDecimal(r.markPrice) : toDecimal(0),
      indexPrice: r.indexPrice ? toDecimal(r.indexPrice) : toDecimal(0),
      timestamp: new Date(r.fundingTime),
    }));
  }

  /**
   * 从 API 获取并缓存
   */
  private async fetchAndCache(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<FundingRateInfo[]> {
    const rates = await this.adapter.getFundingRateHistory(symbol, startTime, endTime);

    // 缓存到数据库
    if (rates.length > 0) {
      const records = rates.map((r) => ({
        symbol: r.symbol,
        fundingRate: r.fundingRate.toString(),
        fundingTime: r.nextFundingTime,
        markPrice: r.markPrice.toString(),
        indexPrice: r.indexPrice.toString(),
      }));

      await fundingRateHistoryRepository.upsertMany(records);
    }

    return rates;
  }

  /**
   * 获取可用的交易对列表
   */
  async getAvailableSymbols(): Promise<string[]> {
    const rates = await this.adapter.getFundingRates();
    return rates.map((r) => r.symbol);
  }

  /**
   * 更新缓存（增量）
   */
  async updateCache(symbols: string[]): Promise<void> {
    logger.info({ symbolCount: symbols.length }, '开始更新数据缓存');

    for (const symbol of symbols) {
      try {
        // 获取最新缓存时间
        const latestTime = await fundingRateHistoryRepository.getLatestTime(symbol);
        const startTime = latestTime
          ? new Date(latestTime.getTime() + 1)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 默认 30 天前
        const endTime = new Date();

        await this.fetchAndCache(symbol, startTime, endTime);
      } catch (error) {
        logger.warn({ symbol, error }, '更新缓存失败');
      }
    }

    logger.info('数据缓存更新完成');
  }
}
