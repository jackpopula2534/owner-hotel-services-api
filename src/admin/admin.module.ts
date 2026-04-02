import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

// Domain modules — each one owns its entities and exports TypeOrmModule so that
// @InjectRepository() in the admin services below can be resolved by NestJS DI.
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { InvoiceItemsModule } from '../invoice-items/invoice-items.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlansModule } from '../plans/plans.module';
import { FeaturesModule } from '../features/features.module';
import { PlanFeaturesModule } from '../plan-features/plan-features.module';
import { SubscriptionFeaturesModule } from '../subscription-features/subscription-features.module';

// Controllers
import { AdminHotelsController } from './admin-hotels.controller';
import { AdminInvoicesController } from './admin-invoices.controller';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { AdminSubscriptionFeaturesController } from './admin-subscription-features.controller';
import { AdminInvoiceAdjustmentsController } from './admin-invoice-adjustments.controller';
import { AdminBillingCycleController } from './admin-billing-cycle.controller';
import { AdminRefundCreditController } from './admin-refund-credit.controller';
import { AdminFeaturesController } from './admin-features.controller';
import { AdminPlansController } from './admin-plans.controller';

// Services
import { AdminHotelsService } from './admin-hotels.service';
import { AdminInvoicesService } from './admin-invoices.service';
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import { AdminSubscriptionFeaturesService } from './admin-subscription-features.service';
import { AdminInvoiceAdjustmentsService } from './admin-invoice-adjustments.service';
import { AdminBillingCycleService } from './admin-billing-cycle.service';
import { AdminRefundCreditService } from './admin-refund-credit.service';
import { AdminFeaturesService } from './admin-features.service';
import { AdminPlansService } from './admin-plans.service';

@Module({
  imports: [
    // Each domain module exposes its Repository<Entity> tokens via "exports: [TypeOrmModule]".
    // Importing the module here makes those tokens available to every service in this module.
    TenantsModule, // → Repository<Tenant>, Repository<TenantCredit>
    SubscriptionsModule, // → Repository<Subscription>, Repository<BillingHistory>
    InvoicesModule, // → Repository<Invoice>, Repository<InvoiceAdjustment>
    InvoiceItemsModule, // → Repository<InvoiceItem>
    PaymentsModule, // → Repository<Payment>, Repository<PaymentRefund>
    PlansModule, // → Repository<Plan>
    FeaturesModule, // → Repository<Feature>
    PlanFeaturesModule, // → Repository<PlanFeature>
    SubscriptionFeaturesModule, // → Repository<SubscriptionFeature>, Repository<SubscriptionFeatureLogs>
    PrismaModule, // → PrismaService (used by several admin services for user queries)
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
