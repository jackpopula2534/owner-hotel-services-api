import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { ProcurementStockService } from './procurement-stock.service';
import { ProcurementStockController } from './procurement-stock.controller';

/**
 * Sprint 3 — read-only procurement view of warehouse stock.
 * Module owns no writes; warehouse module remains the single source of
 * truth for `WarehouseStock` and `InventoryLot` mutations.
 */
@Module({
  imports: [AddonModule],
  controllers: [ProcurementStockController],
  providers: [ProcurementStockService],
  exports: [ProcurementStockService],
})
export class ProcurementStockModule {}
