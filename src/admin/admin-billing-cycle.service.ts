import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionStatus,
  BillingCycle,
} from '../subscriptions/entities/subscription.entity';
import { BillingHistory, BillingEventType } from '../subscriptions/entities/billing-history.entity';
import { Invoice, InvoiceStatus } from '../invoices/entities/invoice.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { Plan } from '../plans/entities/plan.entity';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddonCharge,
  SAAS_VAT_RATE,
  addMonthsUtc,
  addonChargesForRenewal,
  utcMidnight,
  vatOnTop,
} from '../common/billing/addon-billing';
import {
  UpdateBillingCycleDto,
  RenewSubscriptionDto,
  CancelRenewalDto,
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
    private readonly prisma: PrismaService,
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

    const nextBilling = this.computeNextBillingDate(subscription);
    const anchorDate = subscription.billingAnchorDate || subscription.startDate || null;

    return {
      subscriptionCode: subscription.subscriptionCode || subscription.id,
      hotelName: subscription.tenant?.name || 'N/A',
      planName: subscription.plan?.name || 'No Plan',
      planPrice,
      billingCycle: subscription.billingCycle || 'monthly',
      status: subscription.status,
      // Period boundaries carry a real expiry moment -> full ISO datetime.
      currentPeriodStart: this.formatDateTimeOrNa(subscription.startDate),
      currentPeriodEnd: this.formatDateTimeOrNa(subscription.endDate),
      // Billing calendar dates -> date-only is fine.
      nextBillingDate: this.formatDate(nextBilling),
      billingAnchorDate: this.formatDate(anchorDate),
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
   * Compute the next billing date for a subscription.
   *
   * Priority:
   *  1) Use stored `nextBillingDate` if present
   *  2) Fall back to `endDate` (the active period boundary == next charge moment)
   *  3) If `endDate` already passed, roll forward by billing cycle until in the future
   *  4) Returns null only when subscription has no endDate at all
   */
  private computeNextBillingDate(subscription: Subscription): Date | null {
    if (subscription.nextBillingDate) {
      return new Date(subscription.nextBillingDate);
    }

    if (!subscription.endDate) {
      return null;
    }

    const cycle = subscription.billingCycle || BillingCycle.MONTHLY;
    const candidate = new Date(subscription.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Roll forward until the candidate date is in the future
    let safetyCounter = 0;
    while (candidate.getTime() < today.getTime() && safetyCounter < 240) {
      if (cycle === BillingCycle.YEARLY) {
        candidate.setFullYear(candidate.getFullYear() + 1);
      } else {
        candidate.setMonth(candidate.getMonth() + 1);
      }
      safetyCounter += 1;
    }

    return candidate;
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

    // Calculate new dates. Three input modes, in priority order:
    //   1) explicit customEndDate (admin picked a date)
    //   2) periodDays (sub-month renewals such as 1 week)
    //   3) periodMonths (default — falls back to billing cycle)
    const newStartDate = new Date(subscription.endDate);
    let newEndDate: Date;
    let periodMonths: number;
    let periodDays: number | undefined;

    if (dto.customEndDate) {
      newEndDate = new Date(dto.customEndDate);
      if (Number.isNaN(newEndDate.getTime()) || newEndDate <= newStartDate) {
        throw new BadRequestException(
          'customEndDate must be a valid date after the current period end',
        );
      }
      // Approximate months from the chosen end date for amount/invoice math.
      const ms = newEndDate.getTime() - newStartDate.getTime();
      periodMonths = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24 * 30)));
    } else if (dto.periodDays && dto.periodDays > 0) {
      periodDays = dto.periodDays;
      newEndDate = new Date(newStartDate);
      newEndDate.setDate(newEndDate.getDate() + periodDays);
      periodMonths = Math.max(1, Math.round(periodDays / 30));
    } else {
      periodMonths =
        dto.periodMonths || (subscription.billingCycle === BillingCycle.YEARLY ? 12 : 1);
      newEndDate = addMonthsUtc(newStartDate, periodMonths);
    }

    // Calculate renewal amount — แพ็กเกจ × เดือน + add-on (bill-later คิดตามช่วงที่ถึงกำหนด)
    const planPrice = Number(subscription.plan?.priceMonthly || 0);
    const featureRows = await this.prisma.subscription_features.findMany({
      where: { subscription_id: subscription.id, is_active: 1 },
      include: { features: { select: { name: true, code: true } } },
    });
    const charges = addonChargesForRenewal(
      featureRows.map((f) => ({
        id: f.id,
        price: Number(f.price || 0),
        billingMode: f.billing_mode,
        billingStartsOn: f.billing_starts_on,
        billedThrough: f.billed_through,
        cancelAt: f.cancel_at,
      })),
      utcMidnight(newStartDate),
      utcMidnight(newEndDate),
      periodMonths,
    );
    const addonAmount = charges.reduce((sum, c) => sum + c.amount, 0);
    const planAmount = periodDays
      ? Math.round((planPrice / 30) * periodDays)
      : planPrice * periodMonths;

    // For sub-month (week) renewals, prorate by days; otherwise multiply by months.
    // customPrice = ยอดรวมสุดท้ายที่แอดมินกำหนด (รวม VAT แล้ว)
    const computed = vatOnTop(planAmount + addonAmount);
    const renewalAmount = dto.customPrice !== undefined ? dto.customPrice : computed.total;

    // Create invoice if requested
    let invoiceNo: string | undefined;
    let invoiceId: string | undefined;
    const createInvoice = dto.createInvoice !== false;

    if (createInvoice) {
      // Block double-billing: refuse to issue a new subscription invoice while
      // the tenant still has an outstanding (unpaid) one.
      await this.assertNoOutstandingSubscriptionInvoices(subscription.tenantId);
      const names = new Map(featureRows.map((f) => [f.id, f.features?.name ?? 'Add-on']));
      const invoice = await this.createRenewalInvoice(subscription, {
        planAmount,
        planLabel: `${subscription.plan?.name ?? 'แพ็กเกจ'} — ${
          periodDays ? `${periodDays} วัน` : `${periodMonths} เดือน`
        }`,
        charges: charges.map((c) => ({ ...c, name: names.get(c.id) ?? 'Add-on' })),
        featureRefs: new Map(featureRows.map((f) => [f.id, f.feature_id])),
        customTotal: dto.customPrice,
        periodMonths,
      });
      invoiceNo = invoice.invoiceNo;
      invoiceId = invoice.id;
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
      invoiceId,
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
      periodStart:
        this.formatDate(h.periodStart) !== 'N/A' ? this.formatDate(h.periodStart) : undefined,
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
      nextBillingDate: this.formatDate(this.computeNextBillingDate(subscription)),
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
    const remainingDays = Math.max(
      0,
      Math.ceil((end.getTime() - effective.getTime()) / (1000 * 60 * 60 * 24)),
    );

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
    const remainingDays = Math.max(
      0,
      Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    if (totalDays <= 0) return 0;

    const cycleAmount = this.calculateCycleAmount(
      subscription,
      subscription.billingCycle || BillingCycle.MONTHLY,
    );
    const dailyRate = cycleAmount / totalDays;

    return Math.round(dailyRate * remainingDays);
  }

  /**
   * Refuse to create a new subscription invoice while the tenant still owes on
   * an outstanding (pending/finalized) one. Mirrors
   * InvoicesService.assertNoOutstandingSubscriptionInvoices for the TypeORM path.
   */
  private async assertNoOutstandingSubscriptionInvoices(tenantId: string): Promise<void> {
    const outstanding = await this.invoicesRepository.find({
      where: {
        tenantId,
        bookingId: IsNull(),
        subscriptionId: Not(IsNull()),
        status: In(['pending', 'finalized'] as InvoiceStatus[]),
      },
      order: { createdAt: 'ASC' },
    });
    if (outstanding.length > 0) {
      const total = outstanding.reduce((sum, inv) => sum + Number(inv.amount), 0);
      throw new ConflictException({
        success: false,
        error: {
          code: 'OUTSTANDING_INVOICE_EXISTS',
          message:
            'มีใบแจ้งหนี้ที่ยังค้างชำระอยู่ กรุณาชำระหรือยกเลิกใบแจ้งหนี้เดิมก่อนจึงจะออกใบแจ้งหนี้ใหม่ได้',
          outstandingCount: outstanding.length,
          outstandingTotal: total,
          invoices: outstanding.map((inv) => ({
            id: inv.id,
            invoiceNo: inv.invoiceNo,
            amount: Number(inv.amount),
            status: inv.status,
            dueDate: inv.dueDate,
          })),
        },
      });
    }
  }

  /**
   * ใบต่ออายุแบบแยกรายการ: แพ็กเกจ + add-on แต่ละตัว, VAT 7% บวกเพิ่ม (เหมือนหน้าชำระแพ็กเกจ)
   * บันทึก billed_through ของ add-on bill-later ใน transaction เดียวกับการออกใบ
   * — ใบไม่ออก = ไม่ถือว่าเก็บแล้ว รอบหน้าจะคิดย้อนให้ครบ
   */
  private async createRenewalInvoice(
    subscription: Subscription,
    input: {
      planAmount: number;
      planLabel: string;
      charges: Array<AddonCharge & { name: string }>;
      featureRefs: Map<string, string>;
      customTotal?: number;
      periodMonths: number;
    },
  ): Promise<{ id: string; invoiceNo: string; amount: number }> {
    const invoiceNo = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const dueDate = utcMidnight(new Date());
    dueDate.setUTCDate(dueDate.getUTCDate() + 15);

    const net = input.planAmount + input.charges.reduce((sum, c) => sum + c.amount, 0);
    const totals =
      input.customTotal !== undefined
        ? // ยอดที่แอดมินกำหนดถือว่ารวม VAT แล้ว — ถอด VAT ออกเพื่อแสดงรายการ
          (() => {
            const subtotal =
              Math.round((input.customTotal / (1 + SAAS_VAT_RATE / 100)) * 100) / 100;
            return {
              subtotal,
              vatRate: SAAS_VAT_RATE,
              vatAmount: Math.round((input.customTotal - subtotal) * 100) / 100,
              total: input.customTotal,
            };
          })()
        : vatOnTop(net);

    const items: Prisma.invoice_itemsCreateWithoutInvoicesInput[] = [];
    if (input.planAmount > 0) {
      items.push({
        type: 'plan',
        quantity: 1,
        unit_price: input.planAmount,
        amount: input.planAmount,
        ref_id: subscription.planId ?? null,
        description: input.planLabel.slice(0, 255),
      });
    }
    for (const c of input.charges) {
      items.push({
        type: 'feature',
        quantity: c.months,
        unit_price: c.amount / c.months,
        amount: c.amount,
        ref_id: input.featureRefs.get(c.id) ?? null,
        description: `${c.name} — ${c.months} เดือน`.slice(0, 255),
      });
    }
    if (
      input.customTotal !== undefined &&
      Math.round(totals.subtotal * 100) !== Math.round(net * 100)
    ) {
      const diff = Math.round((totals.subtotal - net) * 100) / 100;
      items.push({
        type: 'adjustment',
        quantity: 1,
        unit_price: diff,
        amount: diff,
        description: 'ปรับยอดโดยทีมงาน',
      });
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoices.create({
        data: {
          tenant_id: subscription.tenantId,
          subscription_id: subscription.id,
          invoice_no: invoiceNo,
          amount: totals.total,
          original_amount: totals.total,
          subtotal: totals.subtotal,
          vat_rate: totals.vatRate,
          vat_amount: totals.vatAmount,
          status: 'pending',
          due_date: dueDate,
          notes: `Renewal for ${input.periodMonths} month(s)`,
          invoice_items: { create: items },
        },
        select: { id: true, invoice_no: true },
      });
      for (const c of input.charges) {
        if (!c.billedThrough) continue;
        await tx.subscription_features.update({
          where: { id: c.id },
          data: { billed_through: c.billedThrough },
        });
      }
      return created;
    });

    this.logger.log(`Created renewal invoice ${invoiceNo} for ${totals.total}`);

    return { id: invoice.id, invoiceNo: invoice.invoice_no, amount: totals.total };
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
   * Like formatDate but keeps the time component (full ISO). Used for period
   * boundaries that represent a real expiry moment so the client can display
   * date + time. Returns 'N/A' when there is no date.
   */
  private formatDateTimeOrNa(date: Date | string | null | undefined): string {
    if (!date) return 'N/A';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      return Number.isNaN(d.getTime()) ? 'N/A' : d.toISOString();
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
