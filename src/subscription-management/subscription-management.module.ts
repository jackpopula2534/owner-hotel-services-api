import { Module } from '@nestjs/common';
import { SubscriptionManagementService } from './subscription-management.service';
import { SubscriptionManagementController } from './subscription-management.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlansModule } from '../plans/plans.module';
import { FeaturesModule } from '../features/features.module';
import { SubscriptionFeaturesModule } from '../subscription-features/subscription-features.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [
    SubscriptionsModule,
    PlansModule,
    FeaturesModule,
    SubscriptionFeaturesModule,
    InvoicesModule,
  ],
  controllers: [SubscriptionManagementController],
  providers: [SubscriptionManagementService],
  exports: [SubscriptionManagementService],
})
export class SubscriptionManagementModule {}


