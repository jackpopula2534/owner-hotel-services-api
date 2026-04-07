import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionExpiryService } from './subscription-expiry.service';
import { Subscription } from './entities/subscription.entity';
import { BillingHistory } from './entities/billing-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, BillingHistory]),
    PrismaModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionExpiryService],
  exports: [
    TypeOrmModule, // exports Repository<Subscription> + Repository<BillingHistory>
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
