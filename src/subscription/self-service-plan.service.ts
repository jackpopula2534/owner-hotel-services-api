import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ChangePlanIntent = 'upgrade' | 'downgrade' | 'same';

export interface PreviewChangePlanInput {
  tenantId: string;
  newPlanId: string;
  effectiveDate?: string; // ISO date; defaults to today
}

export interface ConfirmChangePlanInput extends PreviewChangePlanInput {
  reason?: string;
  actorId?: string;
}

export interface ChangePlanPreview {
  intent: ChangePlanIntent;
  currentPlan: { id: string; name: string; priceMonthly: number };
  newPlan: { id: string; name: string; priceMonthly: number };
  effectiveDate: string;
  remainingDays: number;
  proratedCredit: number; // unused portion of current plan
  proratedCharge: number; // unused portion of new plan
  netAmount: number; // positive = tenant owes; negative = tenant credit
  blockedReasons: string[]; // non-empty → cannot confirm (e.g. usage exceeds new limit)
}

/**
 * Self-service plan change for tenants.
 *
 * - Computes proration (calendar-day basis)
 * - Blocks downgrades that would push the tenant over the new plan's limits
 *   (rooms / users / properties)
 * - Wraps the actual subscription mutation in $transaction so we never end
 *   up with subscription updated but invoice missing.
 */
@Injectable()
export class SelfServicePlanService {
  private readonly logger = new Logger(SelfServicePlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  async preview(input: PreviewChangePlanInput): Promise<ChangePlanPreview> {
    const { subscription, currentPlan, newPlan, effectiveDate } =
      await this.loadContext(input);

    const intent = this.classifyIntent(currentPlan.price_monthly, newPlan.price_monthly);
    const blockedReasons = await this.checkLimits(input.tenantId, newPlan);

    const { remainingDays, proratedCredit, proratedCharge } = this.calculateProration(
      subscription,
      currentPlan.price_monthly,
      newPlan.price_monthly,
      effectiveDate,
    );

    return {
      intent,
      currentPlan: {
        id: currentPlan.id,
        name: currentPlan.name,
        priceMonthly: Number(currentPlan.price_monthly),
      },
      newPlan: {
        id: newPlan.id,
        name: newPlan.name,
        priceMonthly: Number(newPlan.price_monthly),
      },
      effectiveDate: effectiveDate.toISOString().split('T')[0],
      remainingDays,
      proratedCredit,
      proratedCharge,
      netAmount: proratedCharge - proratedCredit,
      blockedReasons,
    };
  }

  async confirm(input: ConfirmChangePlanInput) {
    const preview = await this.preview(input);
    if (preview.blockedReasons.length > 0) {
      throw new BadRequestException(
        `Cannot change plan: ${preview.blockedReasons.join('; ')}`,
      );
    }
    if (preview.intent === 'same') {
      throw new BadRequestException('You are already on this plan');
    }

    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: input.tenantId },
      orderBy: { created_at: 'desc' },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscriptions.update({
        where: { id: subscription.id },
        data: {
          previous_plan_id: subscription.plan_id,
          plan_id: input.newPlanId,
          updated_at: new Date(),
        },
      });

      let invoiceId: string | undefined;
      if (preview.netAmount > 0) {
        // Tenant owes a differential — create a top-up invoice.
        const invoice = await tx.invoices.create({
          data: {
            tenant_id: input.tenantId,
            subscription_id: subscription.id,
            invoice_no: this.generateInvoiceNo(),
            amount: preview.netAmount,
            status: 'pending',
            due_date: this.addDays(new Date(), 7),
            notes: `Plan change: ${preview.currentPlan.name} → ${preview.newPlan.name}`,
          },
        });
        invoiceId = invoice.id;
      }

      await tx.billing_history.create({
        data: {
          subscription_id: subscription.id,
          invoice_id: invoiceId,
          eventType: preview.intent === 'upgrade' ? 'upgraded' : 'downgraded',
          description: `Plan change: ${preview.currentPlan.name} → ${preview.newPlan.name}`,
          old_plan_id: subscription.plan_id,
          new_plan_id: input.newPlanId,
          old_amount: preview.currentPlan.priceMonthly,
          new_amount: preview.newPlan.priceMonthly,
          metadata: {
            netAmount: preview.netAmount,
            proratedCredit: preview.proratedCredit,
            proratedCharge: preview.proratedCharge,
            remainingDays: preview.remainingDays,
            reason: input.reason,
          },
          created_by: input.actorId,
        },
      });

      return { subscription: updated, invoiceId };
    });

    this.logger.log(
      `Tenant ${input.tenantId}: ${preview.currentPlan.name} → ${preview.newPlan.name} ` +
        `(intent=${preview.intent}, net=${preview.netAmount})`,
    );

    return {
      success: true,
      ...preview,
      invoiceId: result.invoiceId,
    };
  }

  // ─────────── helpers ───────────

  private async loadContext(input: PreviewChangePlanInput) {
    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: input.tenantId },
      orderBy: { created_at: 'desc' },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.status === 'cancelled') {
      throw new ForbiddenException('Cancelled subscription cannot change plan');
    }

    const [currentPlan, newPlan] = await Promise.all([
      this.prisma.plans.findUnique({ where: { id: subscription.plan_id } }),
      this.prisma.plans.findUnique({ where: { id: input.newPlanId } }),
    ]);
    if (!currentPlan) throw new NotFoundException('Current plan not found');
    if (!newPlan) throw new NotFoundException('Target plan not found');
    if (newPlan.is_active !== 1) {
      throw new BadRequestException('Target plan is not active');
    }

    const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : new Date();
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new BadRequestException('Invalid effectiveDate');
    }

    return { subscription, currentPlan, newPlan, effectiveDate };
  }

  private classifyIntent(
    currentPrice: unknown,
    newPrice: unknown,
  ): ChangePlanIntent {
    const a = Number(currentPrice);
    const b = Number(newPrice);
    if (b > a) return 'upgrade';
    if (b < a) return 'downgrade';
    return 'same';
  }

  /**
   * Block downgrades when the tenant's actual usage already exceeds the
   * limits of the target plan. The user must reduce usage first.
   */
  private async checkLimits(tenantId: string, newPlan: any): Promise<string[]> {
    const reasons: string[] = [];

    const p = this.prisma as any;
    const [roomCount, userCount, propertyCount] = await Promise.all([
      p.room?.count({ where: { tenantId } }).catch(() => 0) ?? Promise.resolve(0),
      p.userTenant?.count({ where: { tenantId } }).catch(() => 0) ?? Promise.resolve(0),
      p.property?.count({ where: { tenantId } }).catch(() => 0) ?? Promise.resolve(0),
    ]);

    if (newPlan.max_rooms > 0 && roomCount > newPlan.max_rooms) {
      reasons.push(`มีห้องพัก ${roomCount} ห้อง (แพ็กเกจใหม่จำกัด ${newPlan.max_rooms})`);
    }
    if (newPlan.max_users > 0 && userCount > newPlan.max_users) {
      reasons.push(`มีผู้ใช้ ${userCount} คน (แพ็กเกจใหม่จำกัด ${newPlan.max_users})`);
    }
    if (newPlan.max_properties > 0 && propertyCount > newPlan.max_properties) {
      reasons.push(
        `มีทรัพย์สิน ${propertyCount} แห่ง (แพ็กเกจใหม่จำกัด ${newPlan.max_properties})`,
      );
    }
    return reasons;
  }

  private calculateProration(
    subscription: { start_date: Date; end_date: Date },
    currentPriceRaw: unknown,
    newPriceRaw: unknown,
    effectiveDate: Date,
  ) {
    const start = new Date(subscription.start_date);
    const end = new Date(subscription.end_date);
    const totalMs = end.getTime() - start.getTime();
    const remainingMs = Math.max(0, end.getTime() - effectiveDate.getTime());

    const totalDays = Math.max(1, Math.ceil(totalMs / 86400_000));
    const remainingDays = Math.max(0, Math.ceil(remainingMs / 86400_000));

    const currentPrice = Number(currentPriceRaw);
    const newPrice = Number(newPriceRaw);

    const proratedCredit = Math.round((currentPrice * remainingDays) / totalDays);
    const proratedCharge = Math.round((newPrice * remainingDays) / totalDays);

    return { remainingDays, proratedCredit, proratedCharge };
  }

  private generateInvoiceNo(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `INV-CHG-${ts}-${rand}`;
  }

  private addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }
}
