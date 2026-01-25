import { Module } from '@nestjs/common';
import { SeederService } from './seeder.service';
import { SeederController } from './seeder.controller';
import { PlansModule } from '../plans/plans.module';
import { FeaturesModule } from '../features/features.module';
import { PlanFeaturesModule } from '../plan-features/plan-features.module';
import { AdminsModule } from '../admins/admins.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionFeaturesModule } from '../subscription-features/subscription-features.module';

@Module({
  imports: [
    PlansModule,
    FeaturesModule,
    PlanFeaturesModule,
    AdminsModule,
    TenantsModule,
    SubscriptionsModule,
    InvoicesModule,
    PaymentsModule,
    SubscriptionFeaturesModule,
  ],
  controllers: [SeederController],
  providers: [SeederService],
  exports: [SeederService],
})
export class SeederModule {}

