import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';

@Module({
  imports: [AddonModule],
  providers: [PurchaseOrdersService],
  controllers: [PurchaseOrdersController],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
