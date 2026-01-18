# 现期费率套利系统

币安现货-永续合约资金费率套利系统，实现市场中性策略。

## 功能特性

- **自动扫描**: 实时监控所有 USDT 永续合约的资金费率
- **智能筛选**: 基于年化收益、成交量、费率稳定性等多维度筛选
- **原子执行**: 现货做多 + 合约做空同步下单，确保对冲完整
- **完整风控**: 仓位限制、止损止盈、保证金监控、紧急停止
- **回测系统**: 支持历史数据回测，评估策略表现
- **实时监控**: REST API、告警通知、CLI 工具

## 快速开始

### 1. 环境要求

- Node.js >= 20.0.0
- MySQL >= 8.0
- 币安 API 密钥（测试网/主网）

### 2. 安装

```bash
# 克隆项目
git clone <repo-url>
cd auto-crypto-xian-qi

# 安装依赖
npm install

# 复制配置文件
cp .env.example .env
cp config.example.yaml config.yaml
```

### 3. 配置

编辑 `.env` 文件，填入数据库和 API 密钥：

```env
# 币安测试网 API
BINANCE_TESTNET_API_KEY=your_testnet_key
BINANCE_TESTNET_API_SECRET=your_testnet_secret
BINANCE_USE_TESTNET=true

# 数据库
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=arbitrage
```

编辑 `config.yaml` 调整策略参数（可选）。

### 4. 初始化数据库

```bash
# 创建数据库
mysql -u root -p -e "CREATE DATABASE arbitrage"

# 运行迁移
npm run db:generate
npm run db:migrate
```

### 5. 运行

```bash
# 开发模式（带热重载）
npm run dev

# 生产模式
npm run build
npm run start
```

## CLI 命令

```bash
# 查看系统状态
npx arbitrage status

# 查看持仓
npx arbitrage positions

# 扫描套利机会
npx arbitrage scan

# 运行回测
npx arbitrage backtest --days=30
```

## API 接口

启动后访问 `http://localhost:3000`

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/v1/status` | GET | 系统状态 |
| `/api/v1/positions` | GET | 持仓列表 |
| `/api/v1/positions/:id` | GET | 持仓详情 |
| `/api/v1/positions/:id/close` | POST | 手动平仓 |
| `/api/v1/opportunities` | GET | 套利机会 |
| `/api/v1/metrics` | GET | 收益指标 |
| `/api/v1/backtest` | POST | 运行回测 |
| `/api/v1/backtest` | GET | 回测历史 |

## 项目结构

```
src/
├── adapters/           # 交易所适配器
│   └── binance/        # 币安 API 封装
├── api/                # REST API
│   └── routes/         # 路由处理
├── backtest/           # 回测系统
├── cli/                # 命令行工具
├── config/             # 配置管理
├── core/               # 核心策略
│   ├── scanner.ts      # 市场扫描器
│   ├── evaluator.ts    # 机会评估器
│   ├── signal.ts       # 信号生成器
│   ├── executor.ts     # 订单执行器
│   └── position.ts     # 持仓管理器
├── db/                 # 数据库
│   ├── schema.ts       # 表结构定义
│   └── repository.ts   # 数据访问层
├── monitoring/         # 监控告警
├── risk/               # 风险管理
├── scheduler/          # 定时任务
├── types/              # 类型定义
└── utils/              # 工具函数
```

## 策略说明

### 套利原理

资金费率套利是一种市场中性策略：

1. **现货做多**: 买入现货 BTC
2. **合约做空**: 卖出等量 USDT 永续合约
3. **收取费率**: 当资金费率为正时，空头（我们）收取费用

### 筛选条件

- 年化收益 >= 30%
- 24h 成交量 >= $1,000,000
- 价差 <= 0.5%
- 费率稳定性 >= 80%（过去 72 小时）

### 风险控制

- 单仓最大 15% 资金
- 总仓位最大 70%
- 组合止损 2%
- 费率止盈 3%
- 最长持仓 14 天
- 紧急止损 15%

## 注意事项

1. **先在测试网验证**: 设置 `BINANCE_USE_TESTNET=true`
2. **资金风险**: 套利策略虽然相对安全，但仍有风险
3. **手续费**: 默认使用 USDT 支付手续费，不启用 BNB 抵扣
4. **网络要求**: 需要稳定的网络连接

## 许可证

MIT
