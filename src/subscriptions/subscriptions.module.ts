import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { Subscription } from './entities/subscription.entity';
import { BillingHistory } from './entities/billing-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, BillingHistory]),
    PrismaModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [
    TypeOrmModule, // exports Repository<Subscription> + Repository<BillingHistory>
    SubscriptionsService,
  ],
})
export class SubscriptionsModule {}
