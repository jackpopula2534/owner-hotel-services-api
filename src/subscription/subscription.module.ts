import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { FeatureAccessModule } from '../feature-access/feature-access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SubscriptionController } from './subscription.controller';

@Module({
  imports: [FeatureAccessModule, SubscriptionsModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionGuard],
  exports: [SubscriptionGuard],
})
export class SubscriptionModule {}


