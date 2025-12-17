import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { FeatureAccessModule } from '../feature-access/feature-access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [FeatureAccessModule, SubscriptionsModule],
  providers: [SubscriptionGuard],
  exports: [SubscriptionGuard],
})
export class SubscriptionModule {}


