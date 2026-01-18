/**
 * 告警系统
 * 
 * 支持：
 * - Webhook 通知（企业微信/飞书/Slack）
 * - 日志记录
 * - 告警级别
 */

import { logger } from '../utils/logger.js';
import { alertRepository } from '../db/repository.js';
import { AlertLevel } from '../types/index.js';

export interface AlertOptions {
  positionId?: string;
  symbol?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 告警器
 */
export class Alerter {
  private readonly webhookUrl?: string;
  private readonly enabled: boolean;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
    this.enabled = !!webhookUrl;
  }

  /**
   * 发送严重告警
   */
  async sendCritical(title: string, message: string, options?: AlertOptions): Promise<void> {
    await this.send(AlertLevel.CRITICAL, title, message, options);
  }

  /**
   * 发送错误告警
   */
  async sendError(title: string, message: string, options?: AlertOptions): Promise<void> {
    await this.send(AlertLevel.ERROR, title, message, options);
  }

  /**
   * 发送警告告警
   */
  async sendWarning(title: string, message: string, options?: AlertOptions): Promise<void> {
    await this.send(AlertLevel.WARNING, title, message, options);
  }

  /**
   * 发送信息告警
   */
  async sendInfo(title: string, message: string, options?: AlertOptions): Promise<void> {
    await this.send(AlertLevel.INFO, title, message, options);
  }

  /**
   * 发送告警
   */
  private async send(
    level: AlertLevel,
    title: string,
    message: string,
    options?: AlertOptions
  ): Promise<void> {
    // 记录日志
    const logData = { level, title, message, ...options };
    switch (level) {
      case AlertLevel.CRITICAL:
        logger.fatal(logData, `[告警] ${title}`);
        break;
      case AlertLevel.ERROR:
        logger.error(logData, `[告警] ${title}`);
        break;
      case AlertLevel.WARNING:
        logger.warn(logData, `[告警] ${title}`);
        break;
      case AlertLevel.INFO:
        logger.info(logData, `[告警] ${title}`);
        break;
    }

    // 保存到数据库
    const alert = await alertRepository.create({
      level,
      title,
      message,
      positionId: options?.positionId,
      symbol: options?.symbol,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : undefined,
      sent: false,
    });

    // 发送 Webhook
    if (this.enabled && this.webhookUrl) {
      try {
        await this.sendWebhook(level, title, message, options);
        await alertRepository.markSent(alert.id);
      } catch (error) {
        logger.error({ error }, 'Webhook 发送失败');
      }
    }
  }

  /**
   * 发送 Webhook
   */
  private async sendWebhook(
    level: AlertLevel,
    title: string,
    message: string,
    options?: AlertOptions
  ): Promise<void> {
    if (!this.webhookUrl) return;

    // 构建消息（支持企业微信格式）
    const emoji = this.getLevelEmoji(level);
    const color = this.getLevelColor(level);

    const payload = {
      msgtype: 'markdown',
      markdown: {
        content: [
          `${emoji} **${level}: ${title}**`,
          '',
          message,
          '',
          options?.symbol ? `> 标的: ${options.symbol}` : '',
          options?.positionId ? `> 持仓ID: ${options.positionId}` : '',
          `> 时间: ${new Date().toLocaleString('zh-CN')}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    };

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook 响应错误: ${response.status}`);
    }
  }

  /**
   * 获取级别对应的 emoji
   */
  private getLevelEmoji(level: AlertLevel): string {
    switch (level) {
      case AlertLevel.CRITICAL:
        return '🚨';
      case AlertLevel.ERROR:
        return '❌';
      case AlertLevel.WARNING:
        return '⚠️';
      case AlertLevel.INFO:
        return 'ℹ️';
    }
  }

  /**
   * 获取级别对应的颜色
   */
  private getLevelColor(level: AlertLevel): string {
    switch (level) {
      case AlertLevel.CRITICAL:
        return '#FF0000';
      case AlertLevel.ERROR:
        return '#FF6B6B';
      case AlertLevel.WARNING:
        return '#FFD93D';
      case AlertLevel.INFO:
        return '#6BCB77';
    }
  }
}
