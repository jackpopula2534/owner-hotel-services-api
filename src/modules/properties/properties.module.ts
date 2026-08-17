import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyTimeSettingsService } from './property-time-settings.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RevenueModule } from '../revenue/revenue.module';

@Module({
  // สถิติของ property อ่านตัวเงินจากสมุดรายได้ ไม่ได้บวกจากตารางการจองเอง
  imports: [PrismaModule, RevenueModule],
  controllers: [PropertiesController],
  providers: [PropertiesService, PropertyTimeSettingsService],
  exports: [PropertiesService, PropertyTimeSettingsService],
})
export class PropertiesModule {}
