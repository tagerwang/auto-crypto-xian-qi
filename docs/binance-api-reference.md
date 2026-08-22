# 币安 API 参考文档

## 官方文档链接

### 现货 API
- **官方文档**: https://binance-docs.github.io/apidocs/spot/cn/
- **GitHub**: https://github.com/binance/binance-spot-api-docs

### 合约 API (USDT 永续)
- **官方文档**: https://binance-docs.github.io/apidocs/futures/cn/
- **GitHub**: https://github.com/binance/binance-futures-connector-python

### 测试网
- **现货测试网**: https://testnet.binance.vision/
- **合约测试网**: https://testnet.binancefuture.com/

---

## API 端点

### 基础 URL

| 环境 | 现货 | 合约 |
|------|------|------|
| 主网 | `https://api.binance.com` | `https://fapi.binance.com` |
| 测试网 | `https://testnet.binance.vision` | `https://testnet.binancefuture.com` |

### WebSocket URL

| 环境 | 现货 | 合约 |
|------|------|------|
| 主网 | `wss://stream.binance.com:9443/ws` | `wss://fstream.binance.com/ws` |
| 测试网 | `wss://testnet.binance.vision/ws` | `wss://stream.binancefuture.com/ws` |

---

## 常用端点

### 市场数据（无需签名）

| 功能 | 现货端点 | 合约端点 |
|------|----------|----------|
| 服务器时间 | `GET /api/v3/time` | `GET /fapi/v1/time` |
| 交易规则 | `GET /api/v3/exchangeInfo` | `GET /fapi/v1/exchangeInfo` |
| 订单簿深度 | `GET /api/v3/depth` | `GET /fapi/v1/depth` |
| 最新成交 | `GET /api/v3/trades` | `GET /fapi/v1/trades` |
| K线数据 | `GET /api/v3/klines` | `GET /fapi/v1/klines` |
| 24h行情 | `GET /api/v3/ticker/24hr` | `GET /fapi/v1/ticker/24hr` |
| 最优挂单 | `GET /api/v3/ticker/bookTicker` | `GET /fapi/v1/ticker/bookTicker` |

### 资金费率（合约专用）

| 功能 | 端点 |
|------|------|
| 当前资金费率 | `GET /fapi/v1/premiumIndex` |
| 历史资金费率 | `GET /fapi/v1/fundingRate` |
| 资金费率信息 | `GET /fapi/v1/fundingInfo` |

### 交易接口（需签名）

| 功能 | 现货端点 | 合约端点 |
|------|----------|----------|
| 下单 | `POST /api/v3/order` | `POST /fapi/v1/order` |
| 取消订单 | `DELETE /api/v3/order` | `DELETE /fapi/v1/order` |
| 查询订单 | `GET /api/v3/order` | `GET /fapi/v1/order` |
| 当前挂单 | `GET /api/v3/openOrders` | `GET /fapi/v1/openOrders` |
| 历史订单 | `GET /api/v3/allOrders` | `GET /fapi/v1/allOrders` |

### 账户接口（需签名）

| 功能 | 现货端点 | 合约端点 |
|------|----------|----------|
| 账户信息 | `GET /api/v3/account` | `GET /fapi/v2/account` |
| 账户余额 | - | `GET /fapi/v2/balance` |
| 持仓信息 | - | `GET /fapi/v2/positionRisk` |
| 资金划转 | `POST /sapi/v1/futures/transfer` | - |

### 合约设置（需签名）

| 功能 | 端点 |
|------|------|
| 调整杠杆 | `POST /fapi/v1/leverage` |
| 更改保证金模式 | `POST /fapi/v1/marginType` |
| 调整逐仓保证金 | `POST /fapi/v1/positionMargin` |

---

## 请求参数

### 通用参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol` | STRING | 交易对，如 `BTCUSDT` |
| `timestamp` | LONG | 请求时间戳（毫秒） |
| `recvWindow` | LONG | 请求有效期（毫秒），默认 5000 |
| `signature` | STRING | HMAC SHA256 签名 |

### 订单参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `side` | ENUM | `BUY` 或 `SELL` |
| `type` | ENUM | `LIMIT`, `MARKET`, `STOP`, `TAKE_PROFIT` 等 |
| `quantity` | DECIMAL | 下单数量 |
| `price` | DECIMAL | 限价单价格 |
| `timeInForce` | ENUM | `GTC`, `IOC`, `FOK` |
| `positionSide` | ENUM | 合约：`BOTH`, `LONG`, `SHORT` |
| `reduceOnly` | STRING | 合约：`true` 或 `false` |

---

## 限频规则

### 现货

| 类型 | 限制 |
|------|------|
| 请求权重 | 1200/分钟 |
| 下单频率 | 10次/秒 |
| 下单总数 | 100,000/天 |

### 合约

| 类型 | 限制 |
|------|------|
| 请求权重 | 2400/分钟 |
| 下单频率 | 10次/秒 |
| 下单总数 | 200,000/天 |

### 权重参考

| 操作 | 权重 |
|------|------|
| 获取订单簿（limit ≤ 100） | 5 |
| 获取订单簿（limit ≤ 500） | 10 |
| 获取订单簿（limit = 1000） | 20 |
| 下单/撤单 | 1 |
| 查询订单 | 2 |
| 账户信息 | 5 |

---

## 错误码

### 常见错误

| 错误码 | 说明 | 处理方式 |
|--------|------|----------|
| -1000 | 未知错误 | 重试 |
| -1001 | 网络断开 | 重试 |
| -1002 | 未授权 | 检查 API Key |
| -1003 | 请求过多 | 等待后重试 |
| -1007 | 服务器超时 | 重试 |
| -1015 | 下单频率超限 | 等待后重试 |
| -1021 | 时间戳不同步 | 同步服务器时间 |
| -1022 | 签名无效 | 检查签名逻辑 |
| -1121 | 交易对无效 | 检查 symbol |

### 订单错误

| 错误码 | 说明 |
|--------|------|
| -2010 | 余额不足 |
| -2011 | 撤单失败（订单不存在） |
| -2013 | 订单不存在 |
| -2014 | API Key 格式错误 |
| -2015 | API Key 权限不足 |
| -4003 | 数量过小 |
| -4014 | 价格精度错误 |

---

## WebSocket 订阅

### 现货

```
// 单一流
wss://stream.binance.com:9443/ws/btcusdt@depth

// 组合流
wss://stream.binance.com:9443/stream?streams=btcusdt@depth/ethusdt@depth
```

### 合约

```
// 标记价格
wss://fstream.binance.com/ws/btcusdt@markPrice

// 全部标记价格
wss://fstream.binance.com/ws/!markPrice@arr@1s
```

### 常用流

| 流 | 说明 |
|------|------|
| `<symbol>@depth` | 订单簿更新 |
| `<symbol>@trade` | 逐笔成交 |
| `<symbol>@kline_<interval>` | K线 |
| `<symbol>@markPrice` | 标记价格（合约） |
| `!markPrice@arr@1s` | 全部标记价格（合约） |

---

## 签名示例

```typescript
import crypto from 'crypto';

const apiSecret = 'your_api_secret';
const params = {
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: 0.001,
  timestamp: Date.now(),
  recvWindow: 5000,
};

// 构建查询字符串
const queryString = new URLSearchParams(params).toString();
// symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&timestamp=xxx&recvWindow=5000

// 生成签名
const signature = crypto
  .createHmac('sha256', apiSecret)
  .update(queryString)
  .digest('hex');

// 最终请求
const url = `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`;
```

---

## 其他资源

- **API 状态**: https://www.binance.com/zh-CN/support/status
- **API 公告**: https://www.binance.com/zh-CN/support/announcement
- **开发者社区**: https://dev.binance.vision/
- **Postman 集合**: https://github.com/binance/binance-api-postman
