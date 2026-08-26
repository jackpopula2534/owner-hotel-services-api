import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuStockService } from './menu-stock.service';
import { MenuInventoryPromoteService } from './menu-inventory-promote.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';
import { SourceWarehouseModule } from '../../inventory/warehouses/source-warehouse.module';

@Module({
  imports: [PrismaModule, AddonModule, SourceWarehouseModule],
  controllers: [MenuController],
  providers: [MenuService, MenuStockService, MenuInventoryPromoteService],
  exports: [MenuService, MenuStockService, MenuInventoryPromoteService],
})
export class MenuModule {}
