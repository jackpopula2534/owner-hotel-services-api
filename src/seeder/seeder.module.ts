import { Module } from '@nestjs/common';
import { SeederService } from './seeder.service';
import { ReadyMadeGoodsSeeder } from './ready-made-goods.seeder';
import { CampPremiumSeeder } from './camp-premium.seeder';
import { RetailPromotionsSeeder } from './retail-promotions.seeder';
import { WarehouseGroupsSeeder } from './warehouse-groups.seeder';
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
import { AddonModule } from '../modules/addons/addon.module';
import { RevenueModule } from '../modules/revenue/revenue.module';

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
    AddonModule,
    RevenueModule,
  ],
  controllers: [SeederController],
  providers: [
    SeederService,
    ReadyMadeGoodsSeeder,
    RetailPromotionsSeeder,
    WarehouseGroupsSeeder,
    CampPremiumSeeder,
  ],
  exports: [SeederService],
})
export class SeederModule {}
