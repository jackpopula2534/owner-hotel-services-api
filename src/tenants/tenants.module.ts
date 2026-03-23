import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantsService } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { TenantsController } from './tenants.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService, HotelDetailService, HotelManagementService],
  exports: [TenantsService, HotelDetailService, HotelManagementService],
})
export class TenantsModule {}


