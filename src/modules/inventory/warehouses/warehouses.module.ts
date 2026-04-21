import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [AddonModule],
  controllers: [WarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
