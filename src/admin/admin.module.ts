import { Module } from '@nestjs/common';
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
  imports: [PrismaModule],
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
