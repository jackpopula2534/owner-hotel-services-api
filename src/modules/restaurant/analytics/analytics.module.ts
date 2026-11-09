import { Module } from '@nestjs/common';
import { RestaurantAnalyticsController } from './analytics.controller';
import { RestaurantAnalyticsService } from './analytics.service';
import { RestaurantDailySalesService } from './daily-sales.service';
import { RestaurantMonthlySalesService } from './monthly-sales.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonModule } from '../../addons/addon.module';
import { RevenueModule } from '../../revenue/revenue.module';

@Module({
  // ทุกยอดเงินในรายงานร้านอาหารอ่านจากสมุดรายได้ ไม่ได้บวก orders.total เองแล้ว
  imports: [AddonModule, RevenueModule],
  controllers: [RestaurantAnalyticsController],
  providers: [
    RestaurantAnalyticsService,
    RestaurantDailySalesService,
    RestaurantMonthlySalesService,
    PrismaService,
  ],
  exports: [
    RestaurantAnalyticsService,
    RestaurantDailySalesService,
    RestaurantMonthlySalesService,
  ],
})
export class RestaurantAnalyticsModule {}
