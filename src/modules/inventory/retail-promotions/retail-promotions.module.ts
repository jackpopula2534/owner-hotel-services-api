import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { RetailMembersController, RetailPromotionsController } from './retail-promotions.controller';
import { RetailPromotionsService } from './retail-promotions.service';

@Module({
  imports: [AddonModule, PrismaModule],
  controllers: [RetailPromotionsController, RetailMembersController],
  providers: [RetailPromotionsService],
  exports: [RetailPromotionsService],
})
export class RetailPromotionsModule {}
