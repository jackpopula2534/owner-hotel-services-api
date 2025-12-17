import { Module } from '@nestjs/common';
import { SeederService } from './seeder.service';
import { SeederController } from './seeder.controller';
import { PlansModule } from '../plans/plans.module';
import { FeaturesModule } from '../features/features.module';
import { PlanFeaturesModule } from '../plan-features/plan-features.module';
import { AdminsModule } from '../admins/admins.module';
import { TenantsModule } from '../tenants/tenants.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    PlansModule,
    FeaturesModule,
    PlanFeaturesModule,
    AdminsModule,
    TenantsModule,
    SubscriptionsModule,
  ],
  controllers: [SeederController],
  providers: [SeederService],
  exports: [SeederService],
})
export class SeederModule {}

