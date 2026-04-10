import { Module } from '@nestjs/common';
import { RestaurantAnalyticsController } from './analytics.controller';
import { RestaurantAnalyticsService } from './analytics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AddonModule } from '../../addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [RestaurantAnalyticsController],
  providers: [RestaurantAnalyticsService, PrismaService],
  exports: [RestaurantAnalyticsService],
})
export class RestaurantAnalyticsModule {}
