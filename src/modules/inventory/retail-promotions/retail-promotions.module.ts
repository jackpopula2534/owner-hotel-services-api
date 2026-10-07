import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { RetailMembersController, RetailPromotionsController } from './retail-promotions.controller';
import { RetailPromotionsService } from './retail-promotions.service';
import { RetailPromotionHealthService } from './retail-promotion-health.service';
import { RetailPromotionReportService } from './retail-promotion-report.service';

@Module({
  imports: [AddonModule, PrismaModule],
  controllers: [RetailPromotionsController, RetailMembersController],
  providers: [RetailPromotionsService, RetailPromotionHealthService, RetailPromotionReportService],
  exports: [RetailPromotionsService, RetailPromotionHealthService],
})
export class RetailPromotionsModule {}
