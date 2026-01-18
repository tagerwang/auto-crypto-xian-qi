# API 文档

## 基础信息

- 基础 URL: `http://localhost:3000`
- 响应格式: JSON

## 接口列表

### 健康检查

#### GET /health

检查服务是否正常运行。

**响应示例:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-18T12:00:00.000Z"
}
```

---

### 系统状态

#### GET /api/v1/status

获取系统运行状态。

**响应示例:**

```json
{
  "isRunning": true,
  "startedAt": "2026-01-18T08:00:00.000Z",
  "lastScanAt": "2026-01-18T12:00:00.000Z",
  "activePositions": 3,
  "totalEquity": "10500.50",
  "unrealizedPnL": "150.25",
  "risk": {
    "isEmergencyStop": false,
    "currentEquity": "10500.50",
    "peakEquity": "10550.00",
    "drawdown": "0.0047"
  },
  "wsConnected": true,
  "timestamp": "2026-01-18T12:00:00.000Z"
}
```

#### GET /api/v1/config

获取当前配置。

#### GET /api/v1/metrics

获取收益指标。

**响应示例:**

```json
{
  "current": {
    "activePositions": 3,
    "totalValue": "3000.00",
    "unrealizedPnL": "45.50",
    "fundingCollected": "120.30"
  },
  "historical": {
    "totalTrades": 25,
    "winRate": "84.00%",
    "totalRealizedPnL": "850.20",
    "avgHoldingDays": "5.2",
    "avgReturn": "34.01"
  }
}
```

#### POST /api/v1/reset-emergency

重置紧急停止状态。

---

### 持仓管理

#### GET /api/v1/positions

获取持仓列表。

**查询参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| status | string | 可选: `active`, `closed` |

**响应示例:**

```json
{
  "count": 3,
  "positions": [
    {
      "id": "uuid-xxx",
      "symbol": "BTCUSDT",
      "status": "ACTIVE",
      "spotQuantity": "0.1",
      "spotEntryPrice": "42000.00",
      "futuresQuantity": "0.1",
      "futuresEntryPrice": "42050.00",
      "fundingInterval": 8,
      "totalFundingCollected": "25.50",
      "fundingRecordCount": 6,
      "unrealizedPnl": "15.20",
      "openedAt": "2026-01-16T10:00:00.000Z"
    }
  ]
}
```

#### GET /api/v1/positions/:id

获取持仓详情。

**响应示例:**

```json
{
  "position": {
    "id": "uuid-xxx",
    "symbol": "BTCUSDT",
    "status": "ACTIVE",
    "spotQuantity": "0.1",
    "spotEntryPrice": "42000.00",
    ...
  },
  "fundingRecords": [
    {
      "id": "uuid-yyy",
      "fundingRate": "0.0001",
      "annualizedRate": "0.3650",
      "fundingAmount": "4.20",
      "settledAt": "2026-01-17T00:00:00.000Z"
    }
  ]
}
```

#### POST /api/v1/positions/:id/close

手动平仓。

**响应示例:**

```json
{
  "success": true,
  "message": "平仓成功",
  "positionId": "uuid-xxx"
}
```

---

### 套利机会

#### GET /api/v1/opportunities

扫描当前套利机会。

**响应示例:**

```json
{
  "timestamp": "2026-01-18T12:00:00.000Z",
  "totalScanned": 150,
  "opportunities": [
    {
      "symbol": "XRPUSDT",
      "fundingRate": "0.0003",
      "fundingInterval": 8,
      "annualizedReturn": "0.3285",
      "volume24h": "50000000",
      "spreadPct": "0.0012",
      "overallScore": 85,
      "isValid": true,
      "reasons": [],
      "riskScore": 15
    }
  ]
}
```

#### GET /api/v1/opportunities/:symbol

获取指定标的详细信息。

---

### 回测

#### POST /api/v1/backtest

运行回测。

**请求体:**

```json
{
  "startDate": "2025-12-01",
  "endDate": "2026-01-01",
  "initialCapital": 10000,
  "symbols": ["BTCUSDT", "ETHUSDT"]
}
```

**响应示例:**

```json
{
  "id": "uuid-xxx",
  "summary": {
    "totalReturn": "8.52%",
    "annualizedReturn": "103.10%",
    "sharpeRatio": "2.35",
    "maxDrawdown": "2.10%",
    "winRate": "85.00%",
    "totalTrades": 20
  },
  "durationMs": 5230
}
```

#### GET /api/v1/backtest

获取回测历史列表。

#### GET /api/v1/backtest/:id

获取回测详情。

---

## 错误响应

```json
{
  "error": "错误类型",
  "message": "详细错误信息"
}
```

常见 HTTP 状态码:

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
