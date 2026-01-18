/**
 * 数据库连接和初始化
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

// 数据库连接池
let pool: mysql.Pool | null = null;

// Drizzle 实例
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * 获取数据库连接配置
 */
function getDbConfig(): mysql.PoolOptions {
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'arbitrage',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

/**
 * 初始化数据库连接
 */
export async function initDatabase(): Promise<void> {
  if (db) {
    logger.warn('数据库已经初始化');
    return;
  }

  const config = getDbConfig();
  
  logger.info({ 
    host: config.host, 
    port: config.port, 
    database: config.database 
  }, '正在连接数据库...');

  try {
    // 创建连接池
    pool = mysql.createPool(config);
    
    // 测试连接
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    // 创建 Drizzle 实例
    db = drizzle(pool, { schema, mode: 'default' });
    
    logger.info('数据库连接成功');
  } catch (error) {
    logger.error({ error }, '数据库连接失败');
    throw error;
  }
}

/**
 * 获取数据库实例
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
    logger.info('数据库连接已关闭');
  }
}

/**
 * 检查数据库连接状态
 */
export async function checkConnection(): Promise<boolean> {
  if (!pool) {
    return false;
  }
  
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch {
    return false;
  }
}

// 导出 schema
export * from './schema.js';
