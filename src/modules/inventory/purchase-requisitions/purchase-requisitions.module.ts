import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';

@Module({
  imports: [AddonModule],
  providers: [PurchaseRequisitionsService],
  controllers: [PurchaseRequisitionsController],
  exports: [PurchaseRequisitionsService],
})
export class PurchaseRequisitionsModule {}
