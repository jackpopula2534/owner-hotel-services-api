import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
  BillingCycle,
} from '../subscriptions/entities/subscription.entity';
import { BillingHistory, BillingEventType } from '../subscriptions/entities/billing-history.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { Plan } from '../plans/entities/plan.entity';
import {
  UpdateBillingCycleDto,
  RenewSubscriptionDto,
  CancelRenewalDto,
  BillingCycleDto,
  BillingCycleResponseDto,
  RenewSubscriptionResponseDto,
  CancelRenewalResponseDto,
  BillingHistoryListDto,
  BillingHistoryItemDto,
  SubscriptionBillingInfoDto,
} from './dto/admin-billing-cycle.dto';

@Injectable()
export class AdminBillingCycleService {
  private readonly logger = new Logger(AdminBillingCycleService.name);

  constructor(
    @InjectRepository(Subscription)
    private subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(BillingHistory)
    private billingHistoryRepository: Repository<BillingHistory>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(SubscriptionFeature)
    private subscriptionFeaturesRepository: Repository<SubscriptionFeature>,
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
  ) {}

  /**
   * GET /api/v1/admin/subscriptions/:id/billing-info
   * Get subscription billing information
   */
  async getBillingInfo(subscriptionId: string): Promise<SubscriptionBillingInfoDto> {
    const subscription = await this.findSubscription(subscriptionId);

    // Get add-ons
    const addons = await this.subscriptionFeaturesRepository.find({
      where: { subscriptionId: subscription.id, isActive: true },
    });
    const addonAmount = addons.reduce((sum, a) => sum + Number(a.price || 0), 0);

    const planPrice = Number(subscription.plan?.priceMonthly || 0);
    const totalMonthlyAmount = planPrice + addonAmount;

    return {
      subscriptionCode: subscription.subscriptionCode || subscription.id,
      hotelName: subscription.tenant?.name || 'N/A',
      planName: subscription.plan?.name || 'No Plan',
      planPrice,
      billingCycle: subscription.billingCycle || 'monthly',
      status: subscription.status,
      currentPeriodStart: this.formatDate(subscription.startDate),
      currentPeriodEnd: this.formatDate(subscription.endDate),
      nextBillingDate: this.formatDate(subscription.nextBillingDate) || this.formatDate(subscription.endDate) || 'N/A',
      billingAnchorDate: this.formatDate(subscription.billingAnchorDate) || this.formatDate(subscription.startDate) || 'N/A',
      autoRenew: subscription.autoRenew,
      renewedCount: subscription.renewedCount || 0,
      lastRenewedAt: this.formatDateTime(subscription.lastRenewedAt),
      addonAmount,
      totalMonthlyAmount,
      cancelledAt: this.formatDateTime(subscription.cancelledAt),
      cancellationReason: subscription.cancellationReason || undefined,
    };
  }

  /**
   * PATCH /api/v1/admin/subscriptions/:id/billing-cycle
   * Update billing cycle (monthly <-> yearly)
   */
  async updateBillingCycle(
    subscriptionId: string,
    dto: UpdateBillingCycleDto,
    adminId?: string,
  ): Promise<BillingCycleResponseDto> {
    const subscription = await this.findSubscription(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Cannot update billing cycle for cancelled subscription');
    }

    const oldCycle = subscription.billingCycle || BillingCycle.MONTHLY;
    const newCycle = dto.billingCycle as unknown as BillingCycle;

    if (oldCycle === newCycle) {
      throw new BadRequestException(`Subscription is already on ${newCycle} billing cycle`);
    }

    // Calculate proration if applicable
    let proratedAmount = 0;
    const applyProration = dto.applyProration !== false;

    if (applyProration) {
      proratedAmount = this.calculateCycleChangeProration(
        subscription,
        oldCycle,
        newCycle,
        dto.effectiveDate,
      );
    }

    // Calculate new end date based on effective date
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();
    const newEndDate = this.calculateNewEndDate(effectiveDate, newCycle);

    // Update subscription
    subscription.billingCycle = newCycle;
    subscription.nextBillingDate = newEndDate;

    // If effective immediately, update dates
    if (!dto.effectiveDate || new Date(dto.effectiveDate) <= new Date()) {
      subscription.startDate = effectiveDate;
      subscription.endDate = newEndDate;
    }

    await this.subscriptionsRepository.save(subscription);

    // Create billing history
    await this.createBillingHistory({
      subscriptionId: subscription.id,
      eventType: BillingEventType.CYCLE_CHANGED,
      description: `Billing cycle changed from ${oldCycle} to ${newCycle}`,
      oldBillingCycle: oldCycle,
      newBillingCycle: newCycle,
      oldAmount: this.calculateCycleAmount(subscription, oldCycle),
      newAmount: this.calculateCycleAmount(subscription, newCycle),
      periodStart: effectiveDate,
      periodEnd: newEndDate,
      createdBy: adminId,
      metadata: { reason: dto.reason, proratedAmount },
    });

    this.logger.log(
      `Subscription ${subscription.subscriptionCode} billing cycle changed: ${oldCycle} -> ${newCycle}`,
    );

    return {
      success: true,
      message: 'Billing cycle updated successfully',
      data: {
        subscriptionId: subscription.id,
        subscriptionCode: subscription.subscriptionCode || subscription.id,
        oldBillingCycle: oldCycle,
        newBillingCycle: newCycle,
        effectiveDate: effectiveDate.toISOString().split('T')[0],
        proratedAmount: applyProration ? proratedAmount : undefined,
        nextBillingDate: newEndDate.toISOString().split('T')[0],
      },
    };
  }

  /**
   * POST /api/v1/admin/subscriptions/:id/renew
   * Manual renewal of subscription
   */
  async renewSubscription(
    subscriptionId: string,
    dto: RenewSubscriptionDto,
    adminId?: string,
  ): Promise<RenewSubscriptionResponseDto> {
    const subscription = await this.findSubscription(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Cannot renew cancelled subscription. Reactivate first.');
    }

    // Calculate renewal period
    const periodMonths = dto.periodMonths || (subscription.billingCycle === BillingCycle.YEARLY ? 12 : 1);

    // Calculate new dates
    const newStartDate = new Date(subscription.endDate);
    const newEndDate = new Date(newStartDate);
    newEndDate.setMonth(newEndDate.getMonth() + periodMonths);

    // Calculate renewal amount
    const planPrice = Number(subscription.plan?.priceMonthly || 0);
    const addons = await this.subscriptionFeaturesRepository.find({
      where: { subscriptionId: subscription.id, isActive: true },
    });
    const addonAmount = addons.reduce((sum, a) => sum + Number(a.price || 0), 0);
    const monthlyTotal = planPrice + addonAmount;
    const renewalAmount = dto.customPrice !== undefined ? dto.customPrice : monthlyTotal * periodMonths;

    // Create invoice if requested
    let invoiceNo: string | undefined;
    const createInvoice = dto.createInvoice !== false;

    if (createInvoice) {
      const invoice = await this.createRenewalInvoice(subscription, renewalAmount, periodMonths);
      invoiceNo = invoice.invoiceNo;
    }

    // Update subscription
    subscription.startDate = newStartDate;
    subscription.endDate = newEndDate;
    subscription.nextBillingDate = newEndDate;
    subscription.status = SubscriptionStatus.ACTIVE;
    subscription.renewedCount = (subscription.renewedCount || 0) + 1;
    subscription.lastRenewedAt = new Date();

    await this.subscriptionsRepository.save(subscription);

    // Create billing history
    await this.createBillingHistory({
      subscriptionId: subscription.id,
      eventType: BillingEventType.RENEWED,
      description: `Subscription renewed for ${periodMonths} month(s)`,
      newAmount: renewalAmount,
      periodStart: newStartDate,
      periodEnd: newEndDate,
      invoiceId: invoiceNo ? (await this.invoicesRepository.findOne({ where: { invoiceNo } }))?.id : undefined,
      createdBy: adminId,
      metadata: { periodMonths, notes: dto.notes },
    });

    this.logger.log(
      `Subscription ${subscription.subscriptionCode} renewed for ${periodMonths} months. Amount: ${renewalAmount}`,
    );

    return {
      success: true,
      message: 'Subscription renewed successfully',
      data: {
        subscriptionId: subscription.id,
        subscriptionCode: subscription.subscriptionCode || subscription.id,
        newStartDate: newStartDate.toISOString().split('T')[0],
        newEndDate: newEndDate.toISOString().split('T')[0],
        renewalAmount,
        invoiceNo,
        renewedCount: subscription.renewedCount,
      },
    };
  }

  /**
   * POST /api/v1/admin/subscriptions/:id/cancel-renewal
   * Cancel auto-renewal or cancel subscription
   */
  async cancelRenewal(
    subscriptionId: string,
    dto: CancelRenewalDto,
    adminId?: string,
  ): Promise<CancelRenewalResponseDto> {
    const subscription = await this.findSubscription(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Subscription is already cancelled');
    }

    let creditAmount = 0;
    const createCredit = dto.createCredit !== false;
    const cancelImmediately = dto.cancelImmediately === true;
    const effectiveEndDate = cancelImmediately ? new Date() : subscription.endDate;

    // Calculate credit for remaining period if cancelling immediately
    if (cancelImmediately && createCredit) {
      creditAmount = this.calculateRemainingCredit(subscription);
    }

    // Update subscription
    subscription.autoRenew = false;
    subscription.cancelledAt = new Date();
    subscription.cancellationReason = dto.reason;

    if (cancelImmediately) {
      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.endDate = new Date();
    }

    await this.subscriptionsRepository.save(subscription);

    // Create billing history
    await this.createBillingHistory({
      subscriptionId: subscription.id,
      eventType: BillingEventType.CANCELLED,
      description: cancelImmediately
        ? 'Subscription cancelled immediately'
        : 'Auto-renewal cancelled, subscription active until end of period',
      periodEnd: effectiveEndDate,
      createdBy: adminId,
      metadata: {
        reason: dto.reason,
        cancelImmediately,
        creditAmount: createCredit ? creditAmount : 0,
      },
    });

    this.logger.log(
      `Subscription ${subscription.subscriptionCode} renewal cancelled. Immediate: ${cancelImmediately}`,
    );

    return {
      success: true,
      message: cancelImmediately
        ? 'Subscription cancelled immediately'
        : 'Subscription renewal cancelled',
      data: {
        subscriptionId: subscription.id,
        subscriptionCode: subscription.subscriptionCode || subscription.id,
        cancelledAt: this.formatDateTime(subscription.cancelledAt) || new Date().toISOString(),
        effectiveEndDate: effectiveEndDate.toISOString().split('T')[0],
        autoRenew: subscription.autoRenew,
        creditAmount: createCredit ? creditAmount : undefined,
        creditCreated: createCredit && creditAmount > 0,
      },
    };
  }

  /**
   * GET /api/v1/admin/subscriptions/:id/billing-history
   * Get billing history for a subscription
   */
  async getBillingHistory(subscriptionId: string): Promise<BillingHistoryListDto> {
    const subscription = await this.findSubscription(subscriptionId);

    const history = await this.billingHistoryRepository.find({
      where: { subscriptionId: subscription.id },
      relations: ['invoice'],
      order: { createdAt: 'DESC' },
      take: 50,
    });

    // Get plan names for history items
    const planIds = new Set<string>();
    history.forEach((h) => {
      if (h.oldPlanId) planIds.add(h.oldPlanId);
      if (h.newPlanId) planIds.add(h.newPlanId);
    });

    const plans = await this.plansRepository.findByIds([...planIds]);
    const planMap = new Map(plans.map((p) => [p.id, p.name]));

    const historyItems: BillingHistoryItemDto[] = history.map((h) => ({
      id: h.id,
      eventType: h.eventType,
      description: h.description || '',
      oldPlan: h.oldPlanId ? planMap.get(h.oldPlanId) : undefined,
      newPlan: h.newPlanId ? planMap.get(h.newPlanId) : undefined,
      oldBillingCycle: h.oldBillingCycle || undefined,
      newBillingCycle: h.newBillingCycle || undefined,
      oldAmount: h.oldAmount ? Number(h.oldAmount) : undefined,
      newAmount: h.newAmount ? Number(h.newAmount) : undefined,
      periodStart: this.formatDate(h.periodStart) !== 'N/A' ? this.formatDate(h.periodStart) : undefined,
      periodEnd: this.formatDate(h.periodEnd) !== 'N/A' ? this.formatDate(h.periodEnd) : undefined,
      invoiceNo: h.invoice?.invoiceNo || undefined,
      createdAt: this.formatDateTime(h.createdAt) || new Date().toISOString(),
      createdBy: h.createdBy || undefined,
    }));

    return {
      subscriptionCode: subscription.subscriptionCode || subscription.id,
      hotelName: subscription.tenant?.name || 'N/A',
      currentPlan: subscription.plan?.name || 'No Plan',
      billingCycle: subscription.billingCycle || 'monthly',
      nextBillingDate: this.formatDate(subscription.nextBillingDate) || this.formatDate(subscription.endDate) || 'N/A',
      history: historyItems,
      total: historyItems.length,
    };
  }

  // ============ Helper Methods ============

  private async findSubscription(id: string): Promise<Subscription> {
    let subscription: Subscription | null = null;

    if (id.startsWith('SUB-')) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { subscriptionCode: id },
        relations: ['tenant', 'plan'],
      });
    }

    if (!subscription) {
      subscription = await this.subscriptionsRepository.findOne({
        where: { id },
        relations: ['tenant', 'plan'],
      });
    }

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }

    return subscription;
  }

  private calculateNewEndDate(startDate: Date, cycle: BillingCycle): Date {
    const endDate = new Date(startDate);
    if (cycle === BillingCycle.YEARLY) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    return endDate;
  }

  private calculateCycleAmount(subscription: Subscription, cycle: BillingCycle): number {
    const monthlyPrice = Number(subscription.plan?.priceMonthly || 0);
    // Yearly typically has discount (e.g., 2 months free)
    return cycle === BillingCycle.YEARLY ? monthlyPrice * 10 : monthlyPrice;
  }

  private calculateCycleChangeProration(
    subscription: Subscription,
    oldCycle: BillingCycle,
    newCycle: BillingCycle,
    effectiveDate?: string,
  ): number {
    if (!subscription.startDate || !subscription.endDate) {
      return 0;
    }

    const start = new Date(subscription.startDate);
    const end = new Date(subscription.endDate);
    const effective = effectiveDate ? new Date(effectiveDate) : new Date();

    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.max(0, Math.ceil((end.getTime() - effective.getTime()) / (1000 * 60 * 60 * 24)));

    if (totalDays <= 0) return 0;

    const oldAmount = this.calculateCycleAmount(subscription, oldCycle);
    const dailyRate = oldAmount / totalDays;
    const remainingValue = dailyRate * remainingDays;

    const newAmount = this.calculateCycleAmount(subscription, newCycle);
    const newDailyRate = newAmount / (newCycle === BillingCycle.YEARLY ? 365 : 30);
    const newCost = newDailyRate * remainingDays;

    return Math.round(newCost - remainingValue);
  }

  private calculateRemainingCredit(subscription: Subscription): number {
    if (!subscription.startDate || !subscription.endDate) {
      return 0;
    }

    const start = new Date(subscription.startDate);
    const end = new Date(subscription.endDate);
    const now = new Date();

    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    if (totalDays <= 0) return 0;

    const cycleAmount = this.calculateCycleAmount(
      subscription,
      subscription.billingCycle || BillingCycle.MONTHLY,
    );
    const dailyRate = cycleAmount / totalDays;

    return Math.round(dailyRate * remainingDays);
  }

  private async createRenewalInvoice(
    subscription: Subscription,
    amount: number,
    periodMonths: number,
  ): Promise<Invoice> {
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    const invoice = this.invoicesRepository.create({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      invoiceNo,
      amount,
      originalAmount: amount,
      status: InvoiceStatus.PENDING,
      dueDate,
      notes: `Renewal for ${periodMonths} month(s)`,
    });

    await this.invoicesRepository.save(invoice);

    this.logger.log(`Created renewal invoice ${invoiceNo} for ${amount}`);

    return invoice;
  }

  private async createBillingHistory(data: Partial<BillingHistory>): Promise<void> {
    const history = this.billingHistoryRepository.create(data);
    await this.billingHistoryRepository.save(history);
  }

  /**
   * Helper: Format date to YYYY-MM-DD
   */
  private formatDate(date: Date | string | null | undefined): string {
    if (!date) return 'N/A';

    try {
      if (typeof date === 'string') {
        return date.split('T')[0];
      }
      return date.toISOString().split('T')[0];
    } catch {
      return 'N/A';
    }
  }

  /**
   * Helper: Format datetime to ISO string
   */
  private formatDateTime(date: Date | string | null | undefined): string | undefined {
    if (!date) return undefined;

    try {
      if (typeof date === 'string') {
        return date;
      }
      return date.toISOString();
    } catch {
      return undefined;
    }
  }
}
