import { Module } from '@nestjs/common';
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
import { InventoryEventListener } from './events/inventory-event.listener';

@Module({
  imports: [
    AddonModule,
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
  ],
  providers: [InventoryEventListener],
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
  ],
})
export class InventoryModule {}
