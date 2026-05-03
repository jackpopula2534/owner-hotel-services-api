import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionExpiryService } from './subscription-expiry.service';
import { TrialReminderService } from './trial-reminder.service';
import { Subscription } from './entities/subscription.entity';
import { BillingHistory } from './entities/billing-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, BillingHistory]),
    PrismaModule,
    ConfigModule,
    EmailModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, SubscriptionExpiryService, TrialReminderService],
  exports: [
    TypeOrmModule, // exports Repository<Subscription> + Repository<BillingHistory>
    SubscriptionsService,
    TrialReminderService,
  ],
})
export class SubscriptionsModule {}
