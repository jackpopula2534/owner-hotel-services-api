import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';
import { WarehouseGroupsService } from './warehouse-groups.service';
import { WarehouseGroupsController } from './warehouse-groups.controller';

@Module({
  imports: [AddonModule],
  controllers: [WarehouseGroupsController, WarehousesController],
  providers: [WarehousesService, WarehouseGroupsService],
  exports: [WarehousesService, WarehouseGroupsService],
})
export class WarehousesModule {}
