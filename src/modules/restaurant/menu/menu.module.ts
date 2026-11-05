import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { MenuStockService } from './menu-stock.service';
import { MenuInventoryPromoteService } from './menu-inventory-promote.service';
import { MenuInventoryLinkService } from './menu-inventory-link.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AddonModule } from '../../addons/addon.module';
import { SourceWarehouseModule } from '../../inventory/warehouses/source-warehouse.module';

@Module({
  imports: [PrismaModule, AddonModule, SourceWarehouseModule],
  controllers: [MenuController],
  providers: [MenuService, MenuStockService, MenuInventoryPromoteService, MenuInventoryLinkService],
  exports: [MenuService, MenuStockService, MenuInventoryPromoteService, MenuInventoryLinkService],
})
export class MenuModule {}
