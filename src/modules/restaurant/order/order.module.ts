import { Module, forwardRef } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderPublicController } from './order-public.controller';
import { OrderService } from './order.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { KitchenModule } from '../kitchen/kitchen.module';
import { MenuModule } from '../menu/menu.module';
import { TableModule } from '../table/table.module';
import { AddonModule } from '../../addons/addon.module';
import { FolioPostingModule } from '../../accounts-receivable/folio-posting/folio-posting.module';
import { RevenueModule } from '../../revenue/revenue.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => KitchenModule),
    MenuModule,
    TableModule,
    AddonModule,
    FolioPostingModule,
    RevenueModule,
  ],
  controllers: [OrderController, OrderPublicController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
