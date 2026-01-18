/**
 * 币安 API 基础客户端
 * 
 * 功能：
 * - REST API 请求（带签名）
 * - 请求限频管理
 * - 错误处理和重试
 * - WebSocket 连接管理
 */

import crypto from 'crypto';
import WebSocket from 'ws';
import { logger, logApi } from '../../utils/logger.js';
import { retry, withTimeout } from '../../utils/retry.js';
import { BinanceApiConfig, BinanceError, BinanceApiError, RequestOptions } from './types.js';

// API 端点
const ENDPOINTS = {
  spot: {
    main: 'https://api.binance.com',
    testnet: 'https://testnet.binance.vision',
  },
  futures: {
    main: 'https://fapi.binance.com',
    testnet: 'https://testnet.binancefuture.com',
  },
  wsSpot: {
    main: 'wss://stream.binance.com:9443/ws',
    testnet: 'wss://testnet.binance.vision/ws',
  },
  wsFutures: {
    main: 'wss://fstream.binance.com/ws',
    testnet: 'wss://stream.binancefuture.com/ws',
  },
};

/**
 * 限频管理器
 */
class RateLimiter {
  private requestCounts: Map<string, number[]> = new Map();
  private readonly windowMs = 60000; // 1 分钟窗口
  private readonly maxRequests: number;

  constructor(maxRequestsPerMinute: number = 1200) {
    this.maxRequests = maxRequestsPerMinute;
  }

  /**
   * 检查是否可以发送请求
   */
  canRequest(key: string = 'default'): boolean {
    this.cleanup(key);
    const timestamps = this.requestCounts.get(key) || [];
    return timestamps.length < this.maxRequests;
  }

  /**
   * 记录请求
   */
  recordRequest(key: string = 'default'): void {
    const timestamps = this.requestCounts.get(key) || [];
    timestamps.push(Date.now());
    this.requestCounts.set(key, timestamps);
  }

  /**
   * 清理过期记录
   */
  private cleanup(key: string): void {
    const now = Date.now();
    const timestamps = this.requestCounts.get(key) || [];
    const valid = timestamps.filter((t) => now - t < this.windowMs);
    this.requestCounts.set(key, valid);
  }

  /**
   * 获取需要等待的时间（毫秒）
   */
  getWaitTime(key: string = 'default'): number {
    this.cleanup(key);
    const timestamps = this.requestCounts.get(key) || [];
    
    if (timestamps.length < this.maxRequests) {
      return 0;
    }
    
    const oldest = timestamps[0];
    if (oldest === undefined) return 0;
    
    return Math.max(0, this.windowMs - (Date.now() - oldest));
  }
}

/**
 * 币安 REST API 客户端
 */
export class BinanceRestClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly testnet: boolean;
  private readonly rateLimiter: RateLimiter;
  private serverTimeOffset: number = 0;

  constructor(config: BinanceApiConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.testnet = config.testnet ?? false;
    this.rateLimiter = new RateLimiter();
  }

  /**
   * 获取基础 URL
   */
  private getBaseUrl(marketType: 'spot' | 'futures'): string {
    const endpoint = ENDPOINTS[marketType];
    return this.testnet ? endpoint.testnet : endpoint.main;
  }

  /**
   * 生成签名
   */
  private sign(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * 同步服务器时间
   */
  async syncServerTime(): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl('spot')}/api/v3/time`);
      const data = await response.json() as { serverTime: number };
      this.serverTimeOffset = data.serverTime - Date.now();
      logger.debug({ offset: this.serverTimeOffset }, '服务器时间已同步');
    } catch (error) {
      logger.warn({ error }, '同步服务器时间失败');
    }
  }

  /**
   * 获取服务器时间戳
   */
  private getServerTimestamp(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /**
   * 发送请求
   */
  async request<T>(options: RequestOptions): Promise<T> {
    const { method, endpoint, params = {}, signed = false, marketType } = options;
    const baseUrl = this.getBaseUrl(marketType);

    // 检查限频
    const waitTime = this.rateLimiter.getWaitTime(marketType);
    if (waitTime > 0) {
      logger.warn({ waitTime, marketType }, '触发限频，等待中...');
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    // 构建查询参数
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        queryParams.append(key, String(value));
      }
    }

    // 添加签名
    if (signed) {
      queryParams.append('timestamp', String(this.getServerTimestamp()));
      queryParams.append('recvWindow', '5000');
      const queryString = queryParams.toString();
      queryParams.append('signature', this.sign(queryString));
    }

    const queryString = queryParams.toString();
    const url = `${baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;

    const startTime = Date.now();

    try {
      // 记录请求
      this.rateLimiter.recordRequest(marketType);

      const response = await retry(
        async () => {
          const res = await withTimeout(
            fetch(url, {
              method,
              headers: {
                'X-MBX-APIKEY': this.apiKey,
                'Content-Type': 'application/json',
              },
            }),
            10000,
            'API 请求超时'
          );

          // 处理 429 限频错误
          if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After');
            const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
            logger.warn({ waitTime, endpoint }, '触发限频 (429)，等待后重试...');
            await new Promise(resolve => setTimeout(resolve, waitTime));
            throw new BinanceError(-1015, 'Rate limited (429)');
          }
          
          // 处理 418 IP 封禁错误
          if (res.status === 418) {
            logger.error({ endpoint }, 'IP 被封禁 (418)，请稍后重试');
            throw new BinanceError(-1003, 'IP banned (418)');
          }

          if (!res.ok) {
            const errorData = await res.json() as BinanceApiError;
            throw new BinanceError(errorData.code, errorData.msg);
          }

          return res.json();
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          shouldRetry: (error) => {
            // 重试网络错误、服务器错误和限频错误
            if (error instanceof BinanceError) {
              // -1015: 限频，-1003: 请求过多，-1001: 网络问题
              const retryableCodes = [-1001, -1003, -1007, -1015, -1016];
              return retryableCodes.includes(error.code);
            }
            return true;
          },
        }
      );

      const durationMs = Date.now() - startTime;
      logApi(method, endpoint, { params, durationMs, statusCode: 200 });

      return response as T;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logApi(method, endpoint, { params, error, durationMs });
      throw error;
    }
  }

  /**
   * GET 请求
   */
  async get<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    marketType: 'spot' | 'futures' = 'spot',
    signed: boolean = false
  ): Promise<T> {
    return this.request<T>({ method: 'GET', endpoint, params, signed, marketType });
  }

  /**
   * POST 请求
   */
  async post<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    marketType: 'spot' | 'futures' = 'spot',
    signed: boolean = true
  ): Promise<T> {
    return this.request<T>({ method: 'POST', endpoint, params, signed, marketType });
  }

  /**
   * DELETE 请求
   */
  async delete<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    marketType: 'spot' | 'futures' = 'spot',
    signed: boolean = true
  ): Promise<T> {
    return this.request<T>({ method: 'DELETE', endpoint, params, signed, marketType });
  }
}

/**
 * WebSocket 连接管理器
 */
export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private readonly testnet: boolean;
  private readonly marketType: 'spot' | 'futures';
  private readonly callbacks: Map<string, Set<(data: unknown) => void>> = new Map();
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isClosing = false;

  constructor(testnet: boolean, marketType: 'spot' | 'futures') {
    this.testnet = testnet;
    this.marketType = marketType;
  }

  /**
   * 获取 WebSocket URL
   */
  private getWsUrl(): string {
    const key = this.marketType === 'spot' ? 'wsSpot' : 'wsFutures';
    return this.testnet ? ENDPOINTS[key].testnet : ENDPOINTS[key].main;
  }

  /**
   * 连接 WebSocket
   */
  connect(streams: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.getWsUrl()}/${streams.join('/')}`;
      
      logger.info({ url, streams }, '正在连接 WebSocket...');
      
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        logger.info('WebSocket 连接成功');
        this.reconnectAttempts = 0;
        this.startPingPong();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error({ error, data: data.toString() }, 'WebSocket 消息解析失败');
        }
      });

      this.ws.on('error', (error) => {
        logger.error({ error }, 'WebSocket 错误');
        if (this.reconnectAttempts === 0) {
          reject(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'WebSocket 连接关闭');
        this.stopPingPong();
        
        if (!this.isClosing) {
          this.scheduleReconnect(streams);
        }
      });
    });
  }

  /**
   * 处理消息
   */
  private handleMessage(message: Record<string, unknown>): void {
    // 处理组合流消息
    if (message.stream && message.data) {
      const stream = message.stream as string;
      const data = message.data;
      const callbacks = this.callbacks.get(stream);
      if (callbacks) {
        for (const callback of callbacks) {
          callback(data);
        }
      }
    } else {
      // 单一流消息
      const eventType = message.e as string;
      if (eventType) {
        const callbacks = this.callbacks.get(eventType);
        if (callbacks) {
          for (const callback of callbacks) {
            callback(message);
          }
        }
      }
    }
  }

  /**
   * 订阅消息
   */
  subscribe(stream: string, callback: (data: unknown) => void): () => void {
    if (!this.callbacks.has(stream)) {
      this.callbacks.set(stream, new Set());
    }
    this.callbacks.get(stream)!.add(callback);

    // 返回取消订阅函数
    return () => {
      const callbacks = this.callbacks.get(stream);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.callbacks.delete(stream);
        }
      }
    };
  }

  /**
   * 开始心跳
   */
  private startPingPong(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  private stopPingPong(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(streams: string[]): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('WebSocket 重连次数超限');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    this.reconnectAttempts++;

    logger.info({ attempt: this.reconnectAttempts, delay }, '计划 WebSocket 重连');

    this.reconnectTimer = setTimeout(() => {
      this.connect(streams).catch((error) => {
        logger.error({ error }, 'WebSocket 重连失败');
      });
    }, delay);
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.isClosing = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.stopPingPong();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.callbacks.clear();
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
