import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { FeatureAccessModule } from '../feature-access/feature-access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionController } from './subscription.controller';
import { SelfServicePlanService } from './self-service-plan.service';

@Module({
  imports: [FeatureAccessModule, SubscriptionsModule, PrismaModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionGuard, SelfServicePlanService],
  exports: [SubscriptionGuard, SelfServicePlanService],
})
export class SubscriptionModule {}
