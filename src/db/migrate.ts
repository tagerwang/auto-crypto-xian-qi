/**
 * 数据库迁移脚本
 * 
 * 运行: npm run db:migrate
 */

import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { config as loadDotenv } from 'dotenv';

// 加载环境变量
loadDotenv();

async function main() {
  console.log('开始数据库迁移...');
  
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'arbitrage',
    multipleStatements: true,
  });

  const db = drizzle(connection);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('数据库迁移完成！');
  } catch (error) {
    console.error('数据库迁移失败:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main();
