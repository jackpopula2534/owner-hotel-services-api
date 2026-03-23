import { Injectable } from '@nestjs/common';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicesService } from '../invoices/invoices.service';
import { PaymentsService } from '../payments/payments.service';
import { FeaturesService } from '../features/features.service';
import { TenantStatus } from '../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../subscriptions/entities/subscription.entity';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';
import { PaymentStatus } from '../payments/entities/payment.entity';

@Injectable()
export class AdminPanelService {
  constructor(
    private tenantsService: TenantsService,
    private subscriptionsService: SubscriptionsService,
    private invoicesService: InvoicesService,
    private paymentsService: PaymentsService,
    private featuresService: FeaturesService,
  ) {}

  /**
   * 9️⃣ SaaS Admin Panel Dashboard
   * Admin ควรเห็น:
   * - Hotel ทั้งหมด
   * - Trial / Active / Expired
   * - Revenue รายเดือน
   * - Feature usage
   * - Payment pending
   */
  async getDashboard(): Promise<{
    summary: {
      totalHotels: number;
      trialHotels: number;
      activeHotels: number;
      expiredHotels: number;
      suspendedHotels: number;
    };
    revenue: {
      thisMonth: number;
      lastMonth: number;
      total: number;
    };
    pendingPayments: number;
    featureUsage: any[];
  }> {
    // 1. Hotel Summary
    const tenants = await this.tenantsService.findAll();
    const summary = {
      totalHotels: tenants.length,
      trialHotels: tenants.filter((t) => t.status === TenantStatus.TRIAL).length,
      activeHotels: tenants.filter((t) => t.status === TenantStatus.ACTIVE)
        .length,
      expiredHotels: tenants.filter((t) => t.status === TenantStatus.EXPIRED)
        .length,
      suspendedHotels: tenants.filter(
        (t) => t.status === TenantStatus.SUSPENDED,
      ).length,
    };

    // 2. Revenue
    const invoices = await this.invoicesService.findAll();
    const paidInvoices = invoices.filter(
      (i) => i.status === InvoiceStatus.PAID,
    );

    const today = new Date();
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(
      today.getFullYear(),
      today.getMonth() - 1,
      1,
    );
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    const thisMonthRevenue = paidInvoices
      .filter((i) => new Date(i.created_at) >= thisMonthStart)
      .reduce((sum, i) => sum + Number(i.amount), 0);

    const lastMonthRevenue = paidInvoices
      .filter(
        (i) =>
          new Date(i.created_at) >= lastMonthStart &&
          new Date(i.created_at) <= lastMonthEnd,
      )
      .reduce((sum, i) => sum + Number(i.amount), 0);

    const totalRevenue = paidInvoices.reduce(
      (sum, i) => sum + Number(i.amount),
      0,
    );

    // 3. Pending Payments
    const payments = await this.paymentsService.findAll();
    const pendingPayments = payments.filter(
      (p) => p.status === PaymentStatus.PENDING,
    ).length;

    // 4. Feature Usage
    const features = await this.featuresService.findAll();
    const subscriptions = await this.subscriptionsService.findAll();
    const featureUsage = features.map((feature) => {
      const usageCount = subscriptions.filter((sub) => {
        const hasPlanFeature = sub.plans_subscriptions_plan_idToplans?.plan_features?.some(
          (pf) => pf.features?.code === feature.code,
        );
        const hasSubscriptionFeature = sub.subscription_features?.some(
          (sf) => sf.features?.code === feature.code,
        );
        return hasPlanFeature || hasSubscriptionFeature;
      }).length;

      return {
        featureCode: feature.code,
        featureName: feature.name,
        usageCount,
        revenue: usageCount * Number(feature.price_monthly),
      };
    });

    return {
      summary,
      revenue: {
        thisMonth: thisMonthRevenue,
        lastMonth: lastMonthRevenue,
        total: totalRevenue,
      },
      pendingPayments,
      featureUsage,
    };
  }

  /**
   * ดึงรายการ hotels ทั้งหมดพร้อม status
   */
  async getAllHotels(): Promise<any[]> {
    const tenants = await this.tenantsService.findAll();
    const subscriptions = await this.subscriptionsService.findAll();

    return tenants.map((tenant) => {
      const subscription = subscriptions.find(
        (s) => s.tenant_id === tenant.id,
      );

      return {
        id: tenant.id,
        name: tenant.name,
        roomCount: tenant.room_count,
        status: tenant.status,
        trialEndsAt: tenant.trial_ends_at,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              plan: subscription.plans_subscriptions_plan_idToplans,
              startDate: subscription.start_date,
              endDate: subscription.end_date,
            }
          : null,
      };
    });
  }

  /**
   * ดึงรายการ pending payments พร้อม invoice details
   */
  async getPendingPaymentsWithDetails(): Promise<any[]> {
    const payments = await this.paymentsService.findAll();
    const pendingPayments = payments.filter(
      (p) => p.status === PaymentStatus.PENDING,
    );

    const result = await Promise.all(
      pendingPayments.map(async (payment) => {
        const invoice = await this.invoicesService.findOne(payment.invoice_id);
        const tenant = invoice
          ? await this.tenantsService.findOne(invoice.tenant_id)
          : null;

        return {
          payment: {
            id: payment.id,
            method: payment.method,
            slipUrl: payment.slip_url,
            status: payment.status,
            createdAt: payment.created_at,
          },
          invoice: invoice
            ? {
                id: invoice.id,
                invoiceNo: invoice.invoice_no,
                amount: invoice.amount,
                dueDate: invoice.due_date,
              }
            : null,
          hotel: tenant
            ? {
                id: tenant.id,
                name: tenant.name,
              }
            : null,
        };
      }),
    );

    return result;
  }
}


