/**
 * 日志系统
 * 
 * 使用 pino 实现结构化日志：
 * - 支持 trace/debug/info/warn/error/fatal 级别
 * - 开发环境美化输出
 * - 生产环境 JSON 格式输出
 * - 交易日志单独记录
 */

import pino from 'pino';
import { existsSync, mkdirSync } from 'fs';

// 确保日志目录存在
const logDir = process.env.LOG_DIR || './logs';
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// 日志级别
const level = process.env.LOG_LEVEL || 'info';

// 是否为开发环境
const isDev = process.env.NODE_ENV !== 'production';

/**
 * 创建基础 logger
 */
function createLogger() {
  const options: pino.LoggerOptions = {
    level,
    base: {
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  // 开发环境使用 pino-pretty 美化输出
  if (isDev) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
    });
  }

  // 生产环境输出 JSON
  return pino(options);
}

/**
 * 主 logger 实例
 */
export const logger = createLogger();

/**
 * 创建子 logger（带模块名前缀）
 */
export function createChildLogger(module: string) {
  return logger.child({ module });
}

/**
 * 交易日志 - 用于记录所有交易相关操作
 */
export const tradeLogger = logger.child({ type: 'trade' });

/**
 * 风控日志 - 用于记录风控相关事件
 */
export const riskLogger = logger.child({ type: 'risk' });

/**
 * API 日志 - 用于记录 API 调用
 */
export const apiLogger = logger.child({ type: 'api' });

/**
 * 记录交易操作
 */
export function logTrade(
  action: 'OPEN' | 'CLOSE' | 'PARTIAL_FILL' | 'CANCEL' | 'ERROR',
  data: {
    symbol: string;
    side?: string;
    quantity?: number | string;
    price?: number | string;
    orderId?: string;
    positionId?: string;
    reason?: string;
    error?: unknown;
    [key: string]: unknown;
  }
) {
  const logData = {
    action,
    ...data,
    timestamp: new Date().toISOString(),
  };

  if (action === 'ERROR') {
    tradeLogger.error(logData, `交易错误: ${data.symbol}`);
  } else {
    tradeLogger.info(logData, `交易操作: ${action} ${data.symbol}`);
  }
}

/**
 * 记录风控事件
 */
export function logRisk(
  event: 'STOP_LOSS' | 'TAKE_PROFIT' | 'MARGIN_CALL' | 'POSITION_LIMIT' | 'DRAWDOWN_ALERT',
  data: {
    symbol?: string;
    positionId?: string;
    currentValue?: number | string;
    threshold?: number | string;
    action?: string;
    [key: string]: unknown;
  }
) {
  const logData = {
    event,
    ...data,
    timestamp: new Date().toISOString(),
  };

  if (event === 'MARGIN_CALL' || event === 'STOP_LOSS') {
    riskLogger.warn(logData, `风控事件: ${event}`);
  } else {
    riskLogger.info(logData, `风控事件: ${event}`);
  }
}

/**
 * 记录 API 调用
 */
export function logApi(
  method: string,
  endpoint: string,
  data: {
    params?: Record<string, unknown>;
    response?: unknown;
    error?: unknown;
    durationMs?: number;
    statusCode?: number;
  }
) {
  const logData = {
    method,
    endpoint,
    ...data,
    timestamp: new Date().toISOString(),
  };

  const symbol = data.params?.symbol ? ` [${data.params.symbol}]` : '';
  
  if (data.error) {
    apiLogger.error(logData, `API 错误: ${method} ${endpoint}${symbol}`);
  } else {
    apiLogger.debug(logData, `API 调用: ${method} ${endpoint}${symbol}`);
  }
}

export default logger;
