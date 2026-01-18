/**
 * 风控管理器
 * 
 * 功能：
 * - 仓位限制检查
 * - 止损止盈监控
 * - 保证金率监控
 * - 账户级别风控
 */

import { logger, logRisk } from '../utils/logger.js';
import { Decimal, toDecimal, safeDivide, decimalMin } from '../utils/decimal.js';
import { RiskConfig } from '../config/schema.js';
import { Alerter } from '../monitoring/alerter.js';
import { positionRepository } from '../db/repository.js';
import { ArbitragePosition, AccountInfo, Balance } from '../types/index.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface PositionSizeResult {
  quantity: Decimal;
  value: Decimal;
  leverage: number;
}

/**
 * 风控管理器
 */
export class RiskManager {
  private accountInfo: AccountInfo | null = null;
  private lastEquity: Decimal = toDecimal(0);
  private peakEquity: Decimal = toDecimal(0);
  private isEmergencyStop: boolean = false;

  constructor(
    public readonly config: RiskConfig,
    private readonly alerter: Alerter
  ) {}

  // ===========================================
  // 仓位检查
  // ===========================================

  /**
   * 检查是否可以开仓
   */
  async canOpenPosition(): Promise<RiskCheckResult> {
    // 1. 检查是否在紧急停止状态
    if (this.isEmergencyStop) {
      return { allowed: false, reason: '系统处于紧急停止状态' };
    }

    // 2. 检查持仓数量限制
    const activeCount = await positionRepository.countActive();
    if (activeCount >= this.config.maxPositions) {
      return {
        allowed: false,
        reason: `持仓数量已达上限 (${activeCount}/${this.config.maxPositions})`,
      };
    }

    // 3. 检查总敞口限制
    if (this.accountInfo) {
      const totalExposure = await this.calculateTotalExposure();
      const maxExposure = this.accountInfo.totalEquity.mul(this.config.maxTotalExposurePct);
      
      if (totalExposure.gte(maxExposure)) {
        return {
          allowed: false,
          reason: `总敞口已达上限 (${totalExposure.toFixed(2)}/${maxExposure.toFixed(2)})`,
        };
      }
    }

    // 4. 检查回撤
    const drawdownResult = await this.checkDrawdown();
    if (!drawdownResult.allowed) {
      return drawdownResult;
    }

    return { allowed: true };
  }

  /**
   * 计算总敞口
   */
  private async calculateTotalExposure(): Promise<Decimal> {
    const positions = await positionRepository.findActive();
    let total = toDecimal(0);

    for (const pos of positions) {
      const value = toDecimal(pos.spotQuantity).mul(toDecimal(pos.spotEntryPrice));
      total = total.plus(value);
    }

    return total;
  }

  /**
   * 检查回撤
   */
  private async checkDrawdown(): Promise<RiskCheckResult> {
    if (!this.accountInfo || this.peakEquity.isZero()) {
      return { allowed: true };
    }

    const currentEquity = this.accountInfo.totalEquity;
    const drawdown = this.peakEquity.minus(currentEquity).div(this.peakEquity);

    // 检查紧急止损线
    if (drawdown.gte(this.config.emergencyStopLoss)) {
      this.isEmergencyStop = true;
      logRisk('DRAWDOWN_ALERT', {
        currentEquity: currentEquity.toString(),
        peakEquity: this.peakEquity.toString(),
        drawdown: drawdown.toString(),
        action: 'EMERGENCY_STOP',
      });
      await this.alerter.sendCritical(
        '紧急止损触发',
        `账户回撤 ${drawdown.mul(100).toFixed(2)}% 超过紧急止损线 ${this.config.emergencyStopLoss * 100}%`
      );
      return {
        allowed: false,
        reason: `紧急止损触发 (回撤 ${drawdown.mul(100).toFixed(2)}%)`,
      };
    }

    // 检查最大回撤告警
    if (drawdown.gte(this.config.maxDrawdownPct)) {
      logRisk('DRAWDOWN_ALERT', {
        currentEquity: currentEquity.toString(),
        peakEquity: this.peakEquity.toString(),
        drawdown: drawdown.toString(),
        action: 'ALERT',
      });
      await this.alerter.sendWarning(
        '回撤告警',
        `账户回撤 ${drawdown.mul(100).toFixed(2)}% 接近最大回撤线 ${this.config.maxDrawdownPct * 100}%`
      );
      return {
        allowed: false,
        reason: `回撤过大 (${drawdown.mul(100).toFixed(2)}%)`,
      };
    }

    return { allowed: true };
  }

  // ===========================================
  // 仓位计算
  // ===========================================

  /**
   * 计算建议的仓位大小
   */
  calculatePositionSize(
    availableBalance: Decimal,
    price: Decimal
  ): PositionSizeResult {
    // 最大单仓比例
    const maxPositionValue = availableBalance.mul(this.config.maxPositionPct);

    // 考虑杠杆后的实际可用资金
    // 现货需要全额，合约只需要保证金
    // 总资金 = 现货资金 + 合约保证金
    // 假设现货和合约各占一半
    const spotValue = maxPositionValue.div(2);
    const futuresMargin = maxPositionValue.div(2);
    const futuresValue = futuresMargin.mul(this.config.targetLeverage);

    // 取较小值
    const positionValue = decimalMin(spotValue, futuresValue);

    // 确保不低于最小仓位
    if (positionValue.lt(this.config.minPositionValue)) {
      return {
        quantity: toDecimal(0),
        value: toDecimal(0),
        leverage: this.config.targetLeverage,
      };
    }

    // 计算数量
    const quantity = safeDivide(positionValue, price);

    return {
      quantity,
      value: positionValue,
      leverage: this.config.targetLeverage,
    };
  }

  // ===========================================
  // 保证金监控
  // ===========================================

  /**
   * 获取当前保证金率
   */
  async getMarginRatio(): Promise<Decimal> {
    if (!this.accountInfo) {
      return toDecimal(1); // 没有数据时返回安全值
    }

    // 保证金率 = 账户权益 / 持仓价值
    const totalExposure = await this.calculateTotalExposure();
    if (totalExposure.isZero()) {
      return toDecimal(1);
    }

    return safeDivide(this.accountInfo.totalEquity, totalExposure);
  }

  /**
   * 检查保证金是否充足
   */
  async checkMargin(): Promise<RiskCheckResult> {
    const marginRatio = await this.getMarginRatio();

    if (marginRatio.lt(this.config.marginCallThreshold)) {
      logRisk('MARGIN_CALL', {
        marginRatio: marginRatio.toString(),
        threshold: this.config.marginCallThreshold,
        action: 'ALERT',
      });
      await this.alerter.sendCritical(
        '保证金告警',
        `保证金率 ${marginRatio.mul(100).toFixed(2)}% 低于告警阈值 ${this.config.marginCallThreshold * 100}%`
      );
      return {
        allowed: false,
        reason: `保证金不足 (${marginRatio.mul(100).toFixed(2)}%)`,
      };
    }

    return { allowed: true };
  }

  // ===========================================
  // 止损止盈检查
  // ===========================================

  /**
   * 检查持仓止损
   */
  checkPositionStopLoss(
    position: ArbitragePosition,
    currentPnLPct: Decimal
  ): { shouldClose: boolean; reason: string } {
    // 组合止损
    if (currentPnLPct.lte(-this.config.combinedStopLossPct)) {
      logRisk('STOP_LOSS', {
        positionId: position.id,
        symbol: position.symbol,
        currentValue: currentPnLPct.toString(),
        threshold: -this.config.combinedStopLossPct,
        action: 'CLOSE',
      });
      return {
        shouldClose: true,
        reason: `组合止损 (亏损 ${currentPnLPct.mul(100).toFixed(2)}%)`,
      };
    }

    return { shouldClose: false, reason: '' };
  }

  /**
   * 检查持仓止盈
   */
  checkPositionTakeProfit(
    position: ArbitragePosition,
    fundingPct: Decimal
  ): { shouldClose: boolean; reason: string } {
    if (fundingPct.gte(this.config.takeProfitFundingPct)) {
      logRisk('TAKE_PROFIT', {
        positionId: position.id,
        symbol: position.symbol,
        currentValue: fundingPct.toString(),
        threshold: this.config.takeProfitFundingPct,
        action: 'CLOSE',
      });
      return {
        shouldClose: true,
        reason: `费率止盈 (累计收益 ${fundingPct.mul(100).toFixed(2)}%)`,
      };
    }

    return { shouldClose: false, reason: '' };
  }

  // ===========================================
  // 状态更新
  // ===========================================

  /**
   * 更新账户信息
   */
  updateAccountInfo(info: AccountInfo): void {
    this.accountInfo = info;
    this.lastEquity = info.totalEquity;

    // 更新峰值权益
    if (info.totalEquity.gt(this.peakEquity)) {
      this.peakEquity = info.totalEquity;
    }
  }

  /**
   * 重置紧急停止状态
   */
  resetEmergencyStop(): void {
    this.isEmergencyStop = false;
    logger.info('紧急停止状态已重置');
  }

  /**
   * 获取当前风控状态
   */
  getStatus(): {
    isEmergencyStop: boolean;
    currentEquity: Decimal;
    peakEquity: Decimal;
    drawdown: Decimal;
    marginRatio: Promise<Decimal>;
  } {
    const drawdown = this.peakEquity.isZero()
      ? toDecimal(0)
      : this.peakEquity.minus(this.lastEquity).div(this.peakEquity);

    return {
      isEmergencyStop: this.isEmergencyStop,
      currentEquity: this.lastEquity,
      peakEquity: this.peakEquity,
      drawdown,
      marginRatio: this.getMarginRatio(),
    };
  }
}
