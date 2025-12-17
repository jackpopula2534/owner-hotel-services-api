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
      .filter((i) => new Date(i.createdAt) >= thisMonthStart)
      .reduce((sum, i) => sum + Number(i.amount), 0);

    const lastMonthRevenue = paidInvoices
      .filter(
        (i) =>
          new Date(i.createdAt) >= lastMonthStart &&
          new Date(i.createdAt) <= lastMonthEnd,
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
        const hasPlanFeature = sub.plan?.planFeatures?.some(
          (pf) => pf.feature?.code === feature.code,
        );
        const hasSubscriptionFeature = sub.subscriptionFeatures?.some(
          (sf) => sf.feature?.code === feature.code,
        );
        return hasPlanFeature || hasSubscriptionFeature;
      }).length;

      return {
        featureCode: feature.code,
        featureName: feature.name,
        usageCount,
        revenue: usageCount * Number(feature.priceMonthly),
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
        (s) => s.tenantId === tenant.id,
      );

      return {
        id: tenant.id,
        name: tenant.name,
        roomCount: tenant.roomCount,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt,
        subscription: subscription
          ? {
              id: subscription.id,
              status: subscription.status,
              plan: subscription.plan,
              startDate: subscription.startDate,
              endDate: subscription.endDate,
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
        const invoice = await this.invoicesService.findOne(payment.invoiceId);
        const tenant = invoice
          ? await this.tenantsService.findOne(invoice.tenantId)
          : null;

        return {
          payment: {
            id: payment.id,
            method: payment.method,
            slipUrl: payment.slipUrl,
            status: payment.status,
            createdAt: payment.createdAt,
          },
          invoice: invoice
            ? {
                id: invoice.id,
                invoiceNo: invoice.invoiceNo,
                amount: invoice.amount,
                dueDate: invoice.dueDate,
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


