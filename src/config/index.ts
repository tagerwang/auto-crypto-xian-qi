/**
 * 配置管理模块
 * 
 * 配置加载优先级（从高到低）：
 * 1. 环境变量
 * 2. config.yaml 文件
 * 3. 默认值
 */

import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';
import { configSchema, type Config } from './schema.js';

// 加载 .env 文件
loadDotenv();

/**
 * 加载 YAML 配置文件
 */
function loadYamlConfig(): Record<string, unknown> {
  const configPaths = ['config.yaml', 'config.yml', 'config.example.yaml'];
  
  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        const parsed = parseYaml(content) as Record<string, unknown>;
        console.log(`已加载配置文件: ${configPath}`);
        return parsed;
      } catch (error) {
        console.error(`解析配置文件 ${configPath} 失败:`, error);
      }
    }
  }
  
  console.log('未找到配置文件，使用默认配置');
  return {};
}

/**
 * 从环境变量覆盖配置
 */
function applyEnvOverrides(yamlConfig: Record<string, unknown>): Record<string, unknown> {
  const config = { ...yamlConfig };
  
  // 交易所配置
  if (process.env.BINANCE_USE_TESTNET !== undefined) {
    if (!config.exchange) config.exchange = {};
    (config.exchange as Record<string, unknown>).testnet = 
      process.env.BINANCE_USE_TESTNET === 'true';
  }
  
  // API 配置
  if (process.env.API_PORT) {
    if (!config.api) config.api = {};
    (config.api as Record<string, unknown>).port = parseInt(process.env.API_PORT, 10);
  }
  
  // 日志级别
  if (process.env.LOG_LEVEL) {
    if (!config.monitoring) config.monitoring = {};
    (config.monitoring as Record<string, unknown>).logLevel = process.env.LOG_LEVEL;
  }
  
  return config;
}

/**
 * 加载并验证配置
 */
function loadConfig(): Config {
  // 1. 加载 YAML 配置
  const yamlConfig = loadYamlConfig();
  
  // 2. 应用环境变量覆盖
  const mergedConfig = applyEnvOverrides(yamlConfig);
  
  // 3. 使用 Zod 验证并填充默认值
  const result = configSchema.safeParse(mergedConfig);
  
  if (!result.success) {
    console.error('配置验证失败:');
    for (const error of result.error.errors) {
      console.error(`  - ${error.path.join('.')}: ${error.message}`);
    }
    throw new Error('配置验证失败，请检查配置文件');
  }
  
  return result.data;
}

// 导出配置实例（单例）
export const config = loadConfig();

// 重新导出类型
export * from './schema.js';
