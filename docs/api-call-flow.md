# API 调用流程文档

本文档详细说明系统中币安 API 的调用流程和架构设计。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           业务层 (Core)                                      │
│  Scanner / Evaluator / Executor / PositionManager                           │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ 调用
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        适配器层 (BinanceAdapter)                             │
│  统一封装现货和合约 API，提供简洁的业务接口                                     │
│  例如：getFundingRates()、get24hVolume()、placeOrder()                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ 委托给
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
           ┌───────────────┐           ┌────────────────┐
           │   SpotApi     │           │  FuturesApi    │
           │  (现货 API)   │           │  (合约 API)    │
           └───────┬───────┘           └───────┬────────┘
                   │                           │
                   └─────────────┬─────────────┘
                                 │ 调用
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      客户端层 (BinanceRestClient)                            │
│  - 签名生成 (HMAC-SHA256)                                                    │
│  - 限频控制 (RateLimiter)                                                    │
│  - 错误重试 (retry + withTimeout)                                           │
│  - 服务器时间同步                                                            │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTP 请求
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         币安 API 服务器                                       │
│  现货: https://api.binance.com                                               │
│  合约: https://fapi.binance.com                                              │
│  测试网: https://testnet.binance.vision / https://testnet.binancefuture.com  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. BinanceRestClient (`src/adapters/binance/client.ts`)

底层 HTTP 客户端，负责与币安 API 服务器通信。

**主要职责：**
- 发送 HTTP 请求（GET/POST/DELETE）
- 生成请求签名（HMAC-SHA256）
- 管理请求限频
- 处理错误和自动重试
- 同步服务器时间

**关键方法：**

```typescript
// 通用请求方法
async request<T>(options: RequestOptions): Promise<T>

// 便捷方法
async get<T>(endpoint, params, marketType, signed): Promise<T>
async post<T>(endpoint, params, marketType, signed): Promise<T>
async delete<T>(endpoint, params, marketType, signed): Promise<T>
```

### 2. SpotApi (`src/adapters/binance/spot.ts`)

现货市场 API 封装。

**主要功能：**
- 获取交易所信息
- 获取订单簿深度
- 获取 24h 成交量
- 下单/取消订单
- 查询账户余额

### 3. FuturesApi (`src/adapters/binance/futures.ts`)

合约市场 API 封装。

**主要功能：**
- 获取资金费率
- 获取历史资金费率
- 获取订单簿深度
- 下单/取消订单
- 查询持仓信息
- 设置杠杆/保证金模式

### 4. BinanceAdapter (`src/adapters/binance/index.ts`)

统一适配器层，为业务模块提供简洁的接口。

**设计理念：**
- 屏蔽现货/合约 API 差异
- 提供类型安全的接口
- 简化调用方式

**常用方法：**

```typescript
// 市场数据
getFundingRates(symbols?: string[]): Promise<FundingRateInfo[]>
getFundingRateHistory(symbol, startTime, endTime): Promise<FundingRateInfo[]>
getOrderBook(symbol, marketType): Promise<OrderBook>
get24hVolume(symbol, marketType): Promise<Decimal>

// 交易操作
placeOrder(params: OrderParams): Promise<Order>
cancelOrder(orderId, symbol, marketType): Promise<boolean>
spotBuy(symbol, quantity): Promise<Order>
futuresOpenShort(symbol, quantity): Promise<Order>

// 账户信息
getBalances(): Promise<{ spot: Balance[]; futures: Balance[] }>
getPositions(symbols?: string[]): Promise<FuturesPosition[]>
```

## 调用流程示例

### 示例 1：获取资金费率

```typescript
// 1. 业务层调用
// scanner.ts
const fundingRates = await this.adapter.getFundingRates();

// 2. 适配器层转发
// adapters/binance/index.ts
async getFundingRates(symbols?: string[]): Promise<FundingRateInfo[]> {
  return this.futuresApi.getFundingRates(symbols);
}

// 3. FuturesApi 调用客户端
// adapters/binance/futures.ts
async getFundingRates(symbols?: string[]): Promise<FundingRateInfo[]> {
  const response = await this.client.get<PremiumIndexResponse[]>(
    '/fapi/v1/premiumIndex',
    symbols ? { symbol: symbols.join(',') } : {},
    'futures'
  );
  return this.transformFundingRates(response);
}

// 4. 客户端发送请求
// adapters/binance/client.ts
async get<T>(endpoint, params, marketType, signed): Promise<T> {
  return this.request<T>({ method: 'GET', endpoint, params, signed, marketType });
}
```

### 示例 2：下单流程

```typescript
// 1. 业务层：Executor 下单
await this.adapter.spotBuy(symbol, quantity);

// 2. 适配器层
async spotBuy(symbol: string, quantity: Decimal): Promise<Order> {
  return this.spotApi.marketBuy(symbol, quantity);
}

// 3. SpotApi 构建订单参数并发送
async marketBuy(symbol: string, quantity: Decimal): Promise<Order> {
  return this.placeOrder({
    symbol,
    side: 'BUY',
    type: 'MARKET',
    quantity,
  });
}

// 4. 客户端发送签名请求
// POST /api/v3/order (signed = true)
```

## 签名机制

币安 API 要求对敏感接口进行签名验证。

### 签名生成过程

```typescript
// 1. 构建查询字符串
const queryParams = new URLSearchParams();
queryParams.append('symbol', 'BTCUSDT');
queryParams.append('side', 'BUY');
queryParams.append('timestamp', '1234567890123');
queryParams.append('recvWindow', '5000');

// 2. 计算签名
const queryString = queryParams.toString();
// queryString = "symbol=BTCUSDT&side=BUY&timestamp=1234567890123&recvWindow=5000"

const signature = crypto
  .createHmac('sha256', API_SECRET)
  .update(queryString)
  .digest('hex');

// 3. 追加签名到请求
queryParams.append('signature', signature);
```

### 时间同步

```typescript
// 同步服务器时间，避免签名失效
await adapter.syncTime();

// 内部实现
async syncServerTime(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v3/time`);
  const { serverTime } = await response.json();
  this.serverTimeOffset = serverTime - Date.now();
}
```

## 限频控制

### 限频策略

| 类型 | 限制 | 窗口 |
|------|------|------|
| 请求权重 | 1200 | 1 分钟 |
| 下单频率 | 10 | 1 秒 |
| 下单总数 | 100000 | 24 小时 |

### RateLimiter 实现

```typescript
class RateLimiter {
  private windowMs = 60000;  // 1 分钟
  private maxRequests = 1200;

  canRequest(key: string): boolean {
    this.cleanup(key);
    const timestamps = this.requestCounts.get(key) || [];
    return timestamps.length < this.maxRequests;
  }

  getWaitTime(key: string): number {
    // 计算需要等待的时间
    const oldest = timestamps[0];
    return Math.max(0, this.windowMs - (Date.now() - oldest));
  }
}
```

### 触发限频处理

```typescript
// 检查限频
const waitTime = this.rateLimiter.getWaitTime(marketType);
if (waitTime > 0) {
  logger.warn({ waitTime, marketType }, '触发限频，等待中...');
  await new Promise(resolve => setTimeout(resolve, waitTime));
}

// 处理 429 响应
if (res.status === 429) {
  const retryAfter = res.headers.get('Retry-After');
  const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
  await new Promise(resolve => setTimeout(resolve, waitTime));
  throw new BinanceError(-1015, 'Rate limited (429)');
}
```

## 错误重试机制

### 可重试错误

| 错误码 | 说明 | 重试 |
|--------|------|------|
| -1001 | 网络断开 | ✅ |
| -1003 | 请求过多 | ✅ |
| -1007 | 服务器超时 | ✅ |
| -1015 | 限频 | ✅ |
| -1016 | 服务不可用 | ✅ |
| 其他 | 业务错误 | ❌ |

### 重试策略

```typescript
const response = await retry(
  async () => {
    // 发送请求
    const res = await withTimeout(fetch(url, options), 10000, 'API 请求超时');
    // 处理响应...
  },
  {
    maxRetries: 3,           // 最多重试 3 次
    initialDelay: 1000,      // 初始延迟 1 秒
    maxDelay: 10000,         // 最大延迟 10 秒
    shouldRetry: (error) => {
      // 判断是否应该重试
      if (error instanceof BinanceError) {
        const retryableCodes = [-1001, -1003, -1007, -1015, -1016];
        return retryableCodes.includes(error.code);
      }
      return true;  // 网络错误默认重试
    },
  }
);
```

## WebSocket 连接

### 用途

实时订阅市场数据，无需轮询：

- 资金费率更新
- 标记价格
- 订单簿深度

### 连接管理

```typescript
// 连接 WebSocket
await adapter.connectWebSocket();

// 订阅资金费率
const unsubscribe = adapter.subscribeFundingRate((data) => {
  console.log('费率更新:', data);
});

// 断开连接
adapter.disconnectWebSocket();
```

### 自动重连

```typescript
private scheduleReconnect(streams: string[]): void {
  // 指数退避重连
  const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
  this.reconnectAttempts++;

  setTimeout(() => {
    this.connect(streams);
  }, delay);
}
```

## 文件结构

```
src/adapters/binance/
├── index.ts      # BinanceAdapter - 统一适配器
├── client.ts     # BinanceRestClient - REST 客户端
│                 # BinanceWebSocket - WebSocket 客户端
│                 # RateLimiter - 限频管理器
├── spot.ts       # SpotApi - 现货 API
├── futures.ts    # FuturesApi - 合约 API
└── types.ts      # 类型定义
```

## 最佳实践

### 1. 使用适配器而非直接调用

```typescript
// ✅ 推荐：通过适配器调用
const rates = await adapter.getFundingRates();

// ❌ 不推荐：直接使用底层 API
const rates = await futuresApi.getFundingRates();
```

### 2. 处理 API 错误

```typescript
try {
  const order = await adapter.spotBuy(symbol, quantity);
} catch (error) {
  if (error instanceof BinanceError) {
    if (error.code === -2010) {
      // 余额不足
    } else if (error.code === -1121) {
      // 无效交易对
    }
  }
  throw error;
}
```

### 3. 避免频繁请求

```typescript
// ✅ 批量获取
const rates = await adapter.getFundingRates();

// ❌ 逐个获取
for (const symbol of symbols) {
  const rate = await adapter.getFundingRates([symbol]);
}
```

### 4. 使用 WebSocket 替代轮询

```typescript
// ✅ 使用 WebSocket 订阅实时数据
adapter.subscribeFundingRate((data) => {
  // 处理更新
});

// ❌ 定时轮询
setInterval(async () => {
  const rates = await adapter.getFundingRates();
}, 1000);
```
