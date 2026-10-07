import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { FolioPostingModule } from '@/modules/accounts-receivable/folio-posting/folio-posting.module';
import { RevenueModule } from '@/modules/revenue/revenue.module';
import { RetailPromotionsModule } from '../retail-promotions/retail-promotions.module';
import { RetailSalesController } from './retail-sales.controller';
import { RetailSalesService } from './retail-sales.service';
import { RetailSaleVoidService } from './retail-sale-void.service';

@Module({
  imports: [AddonModule, PrismaModule, FolioPostingModule, RevenueModule, RetailPromotionsModule],
  controllers: [RetailSalesController],
  providers: [RetailSalesService, RetailSaleVoidService],
  exports: [RetailSalesService],
})
export class RetailSalesModule {}
