# 部署指南

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境

```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

### 3. 启动 MySQL

```bash
# 使用 Docker
docker run -d \
  --name mysql \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=arbitrage \
  -p 3306:3306 \
  mysql:8.0

# 或使用本地 MySQL
mysql -u root -p -e "CREATE DATABASE arbitrage"
```

### 4. 初始化数据库

```bash
npm run db:generate
npm run db:migrate
```

### 5. 启动服务

```bash
# 开发模式
npm run dev

# 查看数据库
npm run db:studio
```

## 生产部署

### 1. 构建

```bash
npm run build
```

### 2. 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/index.js --name arbitrage

# 查看状态
pm2 status

# 查看日志
pm2 logs arbitrage

# 设置开机自启
pm2 startup
pm2 save
```

### 3. 使用 Docker

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY config.example.yaml ./config.yaml

CMD ["node", "dist/index.js"]
```

```bash
# 构建镜像
docker build -t arbitrage .

# 运行
docker run -d \
  --name arbitrage \
  --env-file .env \
  -p 3000:3000 \
  arbitrage
```

### 4. Docker Compose

```yaml
# docker-compose.yaml
version: '3.8'

services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - MYSQL_HOST=db
    depends_on:
      - db
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - ./logs:/app/logs

  db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=arbitrage
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
```

```bash
docker-compose up -d
```

## 监控

### 健康检查

```bash
# 检查 API
curl http://localhost:3000/health

# 检查状态
curl http://localhost:3000/api/v1/status
```

### 日志

```bash
# 查看日志文件
tail -f logs/app.log

# PM2 日志
pm2 logs arbitrage --lines 100
```

### 告警配置

在 `.env` 中配置 Webhook：

```env
# 企业微信
ALERT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx

# 飞书
ALERT_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxx

# Slack
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx
```

## 备份

### 数据库备份

```bash
# 备份
mysqldump -u root -p arbitrage > backup_$(date +%Y%m%d).sql

# 恢复
mysql -u root -p arbitrage < backup_20260118.sql
```

### 定时备份

```bash
# crontab -e
0 2 * * * mysqldump -u root -p'password' arbitrage > /backup/arbitrage_$(date +\%Y\%m\%d).sql
```

## 常见问题

### 1. 连接超时

检查网络连接和 API 密钥是否正确。测试网和主网使用不同的密钥。

### 2. 订单执行失败

检查账户余额是否充足，API 权限是否包含交易权限。

### 3. 费率数据异常

某些新上线的合约可能没有足够的历史数据，会被自动跳过。

### 4. 数据库连接失败

检查 MySQL 服务是否运行，连接信息是否正确。
