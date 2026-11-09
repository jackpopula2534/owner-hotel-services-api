import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { RetailMembersController, RetailPromotionsController } from './retail-promotions.controller';
import { RetailPromotionsService } from './retail-promotions.service';
import { RetailPromotionHealthService } from './retail-promotion-health.service';
import { RetailPromotionReportService } from './retail-promotion-report.service';
import { RetailPromotionCheckoutService } from './retail-promotion-checkout.service';
import { RetailPromotionRewardsService } from './retail-promotion-rewards.service';
import { LoyaltyModule } from '@/loyalty/loyalty.module';

@Module({
  imports: [AddonModule, PrismaModule, LoyaltyModule],
  controllers: [RetailPromotionsController, RetailMembersController],
  providers: [
    RetailPromotionsService,
    RetailPromotionHealthService,
    RetailPromotionReportService,
    RetailPromotionCheckoutService,
    RetailPromotionRewardsService,
  ],
  exports: [RetailPromotionsService, RetailPromotionHealthService, RetailPromotionCheckoutService],
})
export class RetailPromotionsModule {}
