import { Module } from '@nestjs/common';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AddonModule } from '../addons/addon.module';
import { MenuModule } from './menu/menu.module';
import { TableModule } from './table/table.module';
import { ReservationModule } from './reservation/reservation.module';
import { OrderModule } from './order/order.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { RestaurantAnalyticsModule } from './analytics/analytics.module';
import { StaffCallModule } from './staff-call/staff-call.module';

@Module({
  imports: [
    PrismaModule,
    AddonModule,
    MenuModule,
    TableModule,
    ReservationModule,
    OrderModule,
    KitchenModule,
    RestaurantAnalyticsModule,
    StaffCallModule,
  ],
  controllers: [RestaurantController],
  providers: [RestaurantService],
  exports: [RestaurantService],
})
export class RestaurantModule {}
