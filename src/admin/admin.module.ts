import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantCredit } from '../tenants/entities/tenant-credit.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceAdjustment } from '../invoices/entities/invoice-adjustment.entity';
import { InvoiceItem } from '../invoice-items/entities/invoice-item.entity';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentRefund } from '../payments/entities/payment-refund.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { BillingHistory } from '../subscriptions/entities/billing-history.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { SubscriptionFeatureLogs } from '../subscription-features/entities/subscription-feature-log.entity';
import { Plan } from '../plans/entities/plan.entity';
import { Feature } from '../features/entities/feature.entity';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminHotelsController } from './admin-hotels.controller';
import { AdminHotelsService } from './admin-hotels.service';
import { AdminInvoicesController } from './admin-invoices.controller';
import { AdminInvoicesService } from './admin-invoices.service';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminSubscriptionFeaturesController } from './admin-subscription-features.controller';
import { AdminSubscriptionFeaturesService } from './admin-subscription-features.service';
import { AdminInvoiceAdjustmentsController } from './admin-invoice-adjustments.controller';
import { AdminInvoiceAdjustmentsService } from './admin-invoice-adjustments.service';
import { AdminBillingCycleController } from './admin-billing-cycle.controller';
import { AdminBillingCycleService } from './admin-billing-cycle.service';
import { AdminRefundCreditController } from './admin-refund-credit.controller';
import { AdminRefundCreditService } from './admin-refund-credit.service';
import { AdminFeaturesController } from './admin-features.controller';
import { AdminFeaturesService } from './admin-features.service';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      TenantCredit,
      Invoice,
      InvoiceAdjustment,
      InvoiceItem,
      Payment,
      PaymentRefund,
      Subscription,
      BillingHistory,
      SubscriptionFeature,
      SubscriptionFeatureLogs,
      Plan,
      Feature,
    ]),
    PrismaModule,
  ],
  controllers: [
    AdminHotelsController,
    AdminInvoicesController,
    AdminSubscriptionsController,
    AdminSubscriptionFeaturesController,
    AdminInvoiceAdjustmentsController,
    AdminBillingCycleController,
    AdminRefundCreditController,
    AdminFeaturesController,
    AdminPlansController,
  ],
  providers: [
    AdminHotelsService,
    AdminInvoicesService,
    AdminSubscriptionsService,
    AdminSubscriptionFeaturesService,
    AdminInvoiceAdjustmentsService,
    AdminBillingCycleService,
    AdminRefundCreditService,
    AdminFeaturesService,
    AdminPlansService,
  ],
  exports: [
    AdminHotelsService,
    AdminInvoicesService,
    AdminSubscriptionsService,
    AdminSubscriptionFeaturesService,
    AdminInvoiceAdjustmentsService,
    AdminBillingCycleService,
    AdminRefundCreditService,
    AdminFeaturesService,
    AdminPlansService,
  ],
})
export class AdminModule {}
