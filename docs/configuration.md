# 配置说明

## 环境变量 (.env)

### 币安 API 配置

```env
# 主网 API（生产环境）
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret

# 测试网 API（开发/测试）
BINANCE_TESTNET_API_KEY=your_testnet_key
BINANCE_TESTNET_API_SECRET=your_testnet_secret

# 是否使用测试网
BINANCE_USE_TESTNET=true
```

### 数据库配置

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=arbitrage
```

### 监控配置

```env
# 告警 Webhook（企业微信/飞书/Slack）
ALERT_WEBHOOK_URL=https://qyapi.weixin.qq.com/...

# API 端口
API_PORT=3000

# 日志级别
LOG_LEVEL=info
```

## 策略配置 (config.yaml)

### 交易所设置

```yaml
exchange:
  name: binance
  testnet: true
  rateLimit:
    maxRequestsPerMinute: 1200
    maxOrdersPerSecond: 10
```

### 扫描参数

```yaml
strategy:
  scanner:
    minAnnualizedReturn: 0.30    # 最低年化收益 30%
    min24hVolume: 1000000        # 最低日成交量 $1M
    maxSpreadPct: 0.005          # 最大价差 0.5%
    stabilityWindowHours: 72     # 稳定性检查窗口
    minPositiveRatio: 0.8        # 正费率最低占比 80%
    scanIntervalSeconds: 60      # 扫描间隔
```

### 信号参数

```yaml
strategy:
  signals:
    openAnnualizedThreshold: 0.30   # 开仓阈值
    closeAnnualizedThreshold: 0.10  # 平仓阈值（费率下降）
    cooldownHours: 24               # 冷却期
    settlementWindow:
      blackoutBeforeMinutes: 5      # 结算前禁止开仓
      blackoutAfterMinutes: 2       # 结算后禁止开仓
```

### 风控参数

```yaml
strategy:
  risk:
    # 仓位管理
    maxPositionPct: 0.15         # 单仓最大 15%
    maxTotalExposurePct: 0.70    # 总仓位最大 70%
    maxPositions: 5              # 最多 5 个组合
    minPositionValue: 100        # 最小仓位 $100
    
    # 止损止盈
    spreadStopLossPct: 0.008     # 价差止损 0.8%
    combinedStopLossPct: 0.02    # 组合止损 2%
    takeProfitFundingPct: 0.03   # 费率止盈 3%
    maxHoldingDays: 14           # 最长持仓 14 天
    
    # 账户风控
    maxDrawdownPct: 0.10         # 最大回撤 10%
    emergencyStopLoss: 0.15      # 紧急止损 15%
    
    # 保证金
    targetLeverage: 2            # 目标杠杆
    maxLeverage: 3               # 最大杠杆
    marginCallThreshold: 0.15    # 保证金告警 15%
```

### 执行参数

```yaml
strategy:
  execution:
    legTimeoutSeconds: 10        # 单腿超时
    totalTimeoutSeconds: 30      # 总超时
    maxSlippagePct: 0.001        # 最大滑点
    quantityTolerancePct: 0.02   # 数量容忍度
    useLimitOrders: true         # 使用限价单
    maxConcurrentOrders: 2       # 并发订单数
```

### 回测参数

```yaml
backtest:
  defaultPeriodDays: 30
  initialCapital: 10000
  commission:
    spotMaker: 0.001
    spotTaker: 0.001
    futuresMaker: 0.0002
    futuresTaker: 0.0004
    useBnbDiscount: false        # 不使用 BNB 抵扣
  slippage:
    model: VOLUME_BASED
    volumeBased:
      baseSlippage: 0.0002
      volumeMultiplier: 0.00001
```

## 参数调优建议

### 保守型配置

```yaml
strategy:
  scanner:
    minAnnualizedReturn: 0.50    # 更高的阈值
    min24hVolume: 5000000        # 更高的流动性要求
  risk:
    maxPositionPct: 0.10         # 更小的仓位
    maxTotalExposurePct: 0.50
    combinedStopLossPct: 0.015   # 更紧的止损
```

### 激进型配置

```yaml
strategy:
  scanner:
    minAnnualizedReturn: 0.20    # 更低的阈值
    min24hVolume: 500000
  risk:
    maxPositionPct: 0.20
    maxTotalExposurePct: 0.80
    combinedStopLossPct: 0.03    # 更宽松的止损
```
