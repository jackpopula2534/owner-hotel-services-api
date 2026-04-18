import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AddonModule } from '@/modules/addons/addon.module';
import { CategoriesModule } from './categories/categories.module';
import { ItemsModule } from './items/items.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { StockMovementsModule } from './stock-movements/stock-movements.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { GoodsReceivesModule } from './goods-receives/goods-receives.module';
import { StockCountsModule } from './stock-counts/stock-counts.module';
import { ReorderAlertsModule } from './reorder-alerts/reorder-alerts.module';
import { RoomTypeTemplatesModule } from './room-type-templates/room-type-templates.module';
import { RecipesModule } from './recipes/recipes.module';
import { DemandForecastModule } from './demand-forecast/demand-forecast.module';
import { SupplierQuotesModule } from './supplier-quotes/supplier-quotes.module';
import { PriceComparisonsModule } from './price-comparisons/price-comparisons.module';
import { PurchaseRequisitionsModule } from './purchase-requisitions/purchase-requisitions.module';
import { RfqsModule } from './rfqs/rfqs.module';
import { InventoryEventListener } from './events/inventory-event.listener';
// New 2026-Q2 modules
import { LotsModule } from './lots/lots.module';
import { QRModule } from './qr/qr.module';
import { QCModule } from './qc/qc.module';
import {
  InventoryDashboardController,
  InventoryReportsController,
} from './dashboard/inventory-dashboard.controller';
import { InventoryQueueProcessor, INVENTORY_QUEUE } from './queue/inventory.queue.processor';
import { InventoryQueueScheduler } from './queue/inventory.queue.scheduler';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [
    AddonModule,
    PrismaModule,
    CategoriesModule,
    ItemsModule,
    WarehousesModule,
    SuppliersModule,
    StockMovementsModule,
    PurchaseOrdersModule,
    GoodsReceivesModule,
    StockCountsModule,
    ReorderAlertsModule,
    RoomTypeTemplatesModule,
    RecipesModule,
    DemandForecastModule,
    SupplierQuotesModule,
    PriceComparisonsModule,
    PurchaseRequisitionsModule,
    RfqsModule,
    // 2026-Q2 new modules
    LotsModule,
    QRModule,
    QCModule,
    BullModule.registerQueue({ name: INVENTORY_QUEUE }),
  ],
  controllers: [InventoryDashboardController, InventoryReportsController],
  providers: [
    InventoryEventListener,
    InventoryQueueProcessor,
    InventoryQueueScheduler,
  ],
  exports: [
    CategoriesModule,
    ItemsModule,
    WarehousesModule,
    SuppliersModule,
    StockMovementsModule,
    PurchaseOrdersModule,
    GoodsReceivesModule,
    StockCountsModule,
    ReorderAlertsModule,
    RoomTypeTemplatesModule,
    RecipesModule,
    DemandForecastModule,
    SupplierQuotesModule,
    PriceComparisonsModule,
    PurchaseRequisitionsModule,
    RfqsModule,
    LotsModule,
    QRModule,
    QCModule,
  ],
})
export class InventoryModule {}
