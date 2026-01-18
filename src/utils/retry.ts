/**
 * 重试工具
 * 
 * 提供带指数退避的重试机制
 */

import { logger } from './logger.js';

export interface RetryOptions {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟（毫秒） */
  initialDelay: number;
  /** 最大延迟（毫秒） */
  maxDelay: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 是否添加随机抖动 */
  jitter: boolean;
  /** 可重试的错误判断函数 */
  shouldRetry?: (error: unknown) => boolean;
  /** 重试回调 */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

const defaultOptions: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
  shouldRetry: () => true,
};

/**
 * 计算下次重试延迟
 */
function calculateDelay(
  attempt: number,
  options: RetryOptions
): number {
  // 指数退避
  let delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  
  // 限制最大延迟
  delay = Math.min(delay, options.maxDelay);
  
  // 添加随机抖动（±10%）
  if (options.jitter) {
    const jitterRange = delay * 0.1;
    delay = delay - jitterRange + Math.random() * jitterRange * 2;
  }
  
  return Math.floor(delay);
}

/**
 * 等待指定时间
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步函数执行
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts: RetryOptions = { ...defaultOptions, ...options };
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 检查是否应该重试
      if (attempt >= opts.maxRetries || !opts.shouldRetry?.(error)) {
        throw error;
      }
      
      // 计算延迟
      const delay = calculateDelay(attempt, opts);
      
      // 重试回调
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1, delay);
      } else {
        logger.warn(
          { error, attempt: attempt + 1, delay },
          `操作失败，${delay}ms 后重试 (${attempt + 1}/${opts.maxRetries})`
        );
      }
      
      // 等待
      await sleep(delay);
    }
  }
  
  // 不应该到达这里，但为了类型安全
  throw lastError;
}

/**
 * 带超时的 Promise
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = '操作超时'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${errorMessage} (${timeoutMs}ms)`));
    }, timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * 批量执行，限制并发数
 */
export async function batchExecute<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  
  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      if (item !== undefined) {
        results[currentIndex] = await fn(item, currentIndex);
      }
    }
  }
  
  // 创建指定数量的 worker
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());
  
  await Promise.all(workers);
  return results;
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = interval - (now - lastCall);
    
    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}
