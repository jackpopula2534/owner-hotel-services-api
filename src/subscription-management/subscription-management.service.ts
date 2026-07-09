import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';
import { SubscriptionActor } from './subscription-actor';

@Injectable()
export class SubscriptionManagementService {
  constructor(
    private subscriptionsService: SubscriptionsService,
    private plansService: PlansService,
    private invoicesService: InvoicesService,
  ) {}

  /**
   * Upgrade a subscription's plan, charging the prorated difference.
   *
   * The subscription is addressed by id supplied in the request body, so the
   * caller's right to touch it must be established explicitly.
   */
  async upgradePlan(
    actor: SubscriptionActor,
    subscriptionId: string,
    newPlanId: string,
    options: { createInvoice?: boolean } = {},
  ): Promise<{
    subscription: any;
    proratedAmount: number;
    invoice: any;
  }> {
    const { createInvoice = true } = options;

    const subscription = await this.subscriptionsService.findOne(subscriptionId);
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    this.assertCanManage(actor, subscription.tenant_id);

    const newPlan = await this.plansService.findOne(newPlanId);
    if (!newPlan) {
      throw new NotFoundException('Plan not found');
    }

    // คำนวณ prorate
    const proratedAmount = this.calculateProrate(
      Number(subscription.plans_subscriptions_plan_idToplans.price_monthly),
      Number(newPlan.price_monthly),
      subscription.start_date,
      subscription.end_date,
    );

    // สร้าง invoice สำหรับ upgrade (prorate)
    // ข้ามได้เมื่อ caller ออกใบแจ้งหนี้เองอยู่แล้ว — เช่น flow checkout
    // (trial → paid) ที่ออกใบเต็มเดือน (ราคาแผน + VAT) เอง การสร้างใบ prorate
    // ที่นี่ซ้ำอีกใบทำให้เกิดใบแจ้งหนี้ซ้ำ (UPG-… ฿prorate คู่กับ INV-… เต็มเดือน)
    const invoice = createInvoice
      ? await this.invoicesService.create({
          tenantId: subscription.tenant_id,
          subscriptionId: subscription.id,
          invoiceNo: `UPG-${Date.now()}`,
          amount: proratedAmount,
          status: InvoiceStatus.PENDING,
          dueDate: new Date().toISOString(),
        })
      : null;

    // Update subscription (จะ activate เมื่อ approve payment)
    await this.subscriptionsService.update(subscriptionId, {
      planId: newPlanId,
    });

    return {
      subscription: await this.subscriptionsService.findOne(subscriptionId),
      proratedAmount,
      invoice,
    };
  }

  /**
   * A tenant may only manage its own subscription; a platform admin may manage
   * any. Tenant scoping in TenantScopeMiddleware already hides other tenants'
   * rows from `findOne()`, so this is a second, explicit barrier — and the only
   * one that applies to platform admins, whose requests skip that middleware.
   */
  private assertCanManage(actor: SubscriptionActor, ownerTenantId: string): void {
    if (actor?.isPlatformAdmin) {
      return;
    }

    if (!actor?.tenantId || actor.tenantId !== ownerTenantId) {
      throw new ForbiddenException('You do not have permission to manage this subscription.');
    }
  }

  /**
   * คำนวณ prorate สำหรับ upgrade
   */
  private calculateProrate(
    oldPrice: number,
    newPrice: number,
    startDate: Date,
    endDate: Date,
  ): number {
    const today = new Date();
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const remainingDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const dailyOldPrice = oldPrice / 30; // สมมติว่า 30 วันต่อเดือน
    const dailyNewPrice = newPrice / 30;

    const remainingOldCost = dailyOldPrice * remainingDays;
    const remainingNewCost = dailyNewPrice * remainingDays;

    // ต้องจ่ายส่วนต่าง
    return Math.max(0, remainingNewCost - remainingOldCost);
  }
}
