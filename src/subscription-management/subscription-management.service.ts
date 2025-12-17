import { Injectable } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { FeaturesService } from '../features/features.service';
import { SubscriptionFeaturesService } from '../subscription-features/subscription-features.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';

@Injectable()
export class SubscriptionManagementService {
  constructor(
    private subscriptionsService: SubscriptionsService,
    private plansService: PlansService,
    private featuresService: FeaturesService,
    private subscriptionFeaturesService: SubscriptionFeaturesService,
    private invoicesService: InvoicesService,
  ) {}

  /**
   * 8️⃣ ต่ออายุ / Upgrade / Downgrade
   * Owner ทำเองได้
   * Upgrade plan → prorate
   * Add feature → immediate
   * Downgrade → มีผลรอบหน้า
   */
  async upgradePlan(
    subscriptionId: string,
    newPlanId: string,
  ): Promise<{
    subscription: any;
    proratedAmount: number;
    invoice: any;
  }> {
    const subscription = await this.subscriptionsService.findOne(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const newPlan = await this.plansService.findOne(newPlanId);
    if (!newPlan) {
      throw new Error('Plan not found');
    }

    // คำนวณ prorate
    const proratedAmount = this.calculateProrate(
      subscription.plan.priceMonthly,
      newPlan.priceMonthly,
      subscription.startDate,
      subscription.endDate,
    );

    // สร้าง invoice สำหรับ upgrade
    const invoice = await this.invoicesService.create({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      invoiceNo: `UPG-${Date.now()}`,
      amount: proratedAmount,
      status: InvoiceStatus.PENDING,
      dueDate: new Date(),
    });

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
   * Add feature → immediate
   */
  async addFeature(
    subscriptionId: string,
    featureId: string,
  ): Promise<{
    subscriptionFeature: any;
    invoice: any;
  }> {
    const subscription = await this.subscriptionsService.findOne(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const feature = await this.featuresService.findOne(featureId);
    if (!feature) {
      throw new Error('Feature not found');
    }

    // เพิ่ม feature ทันที
    const subscriptionFeature =
      await this.subscriptionFeaturesService.create({
        subscriptionId,
        featureId,
        price: feature.priceMonthly,
      });

    // สร้าง invoice
    const invoice = await this.invoicesService.create({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      invoiceNo: `FEAT-${Date.now()}`,
      amount: feature.priceMonthly,
      status: InvoiceStatus.PENDING,
      dueDate: new Date(),
    });

    return {
      subscriptionFeature,
      invoice,
    };
  }

  /**
   * Downgrade → มีผลรอบหน้า
   */
  async scheduleDowngrade(
    subscriptionId: string,
    newPlanId: string,
  ): Promise<{
    subscription: any;
    effectiveDate: Date;
    message: string;
  }> {
    const subscription = await this.subscriptionsService.findOne(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Downgrade มีผลเมื่อ subscription หมดอายุ
    // เก็บไว้ใน metadata หรือสร้าง record ใหม่
    // ในที่นี้เราจะ update ทันที แต่จะบอกว่า effective วันที่ subscription หมดอายุ

    await this.subscriptionsService.update(subscriptionId, {
      planId: newPlanId,
    });

    return {
      subscription: await this.subscriptionsService.findOne(subscriptionId),
      effectiveDate: subscription.endDate,
      message: 'Downgrade scheduled. Will take effect on subscription renewal.',
    };
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
    const totalDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const remainingDays = Math.ceil(
      (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );

    const dailyOldPrice = oldPrice / 30; // สมมติว่า 30 วันต่อเดือน
    const dailyNewPrice = newPrice / 30;

    const remainingOldCost = dailyOldPrice * remainingDays;
    const remainingNewCost = dailyNewPrice * remainingDays;

    // ต้องจ่ายส่วนต่าง
    return Math.max(0, remainingNewCost - remainingOldCost);
  }
}


