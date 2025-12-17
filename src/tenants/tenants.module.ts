import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantsService } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { TenantsController } from './tenants.controller';
import { Tenant } from './entities/tenant.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { Plan } from '../plans/entities/plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Subscription, Invoice, Plan])],
  controllers: [TenantsController],
  providers: [TenantsService, HotelDetailService, HotelManagementService],
  exports: [TenantsService, HotelDetailService, HotelManagementService],
})
export class TenantsModule {}


