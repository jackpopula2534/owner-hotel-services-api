import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantsService } from './tenants.service';
import { HotelDetailService } from './hotel-detail.service';
import { HotelManagementService } from './hotel-management.service';
import { TenantDefaultDataService } from './tenant-default-data.service';
import { TenantsController } from './tenants.controller';
import { Tenant } from './entities/tenant.entity';
import { TenantCredit } from './entities/tenant-credit.entity';

// Domain modules that provide the foreign repositories used by HotelDetailService
// and HotelManagementService via @InjectRepository()
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, TenantCredit]), // own entities only
    SubscriptionsModule, // provides Repository<Subscription>, Repository<BillingHistory>
    InvoicesModule, // provides Repository<Invoice>, Repository<InvoiceAdjustment>
    PlansModule, // provides Repository<Plan>
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TenantsController],
  providers: [TenantsService, HotelDetailService, HotelManagementService, TenantDefaultDataService],
  exports: [
    TypeOrmModule, // exports Repository<Tenant>, Repository<TenantCredit>
    TenantsService,
    HotelDetailService,
    HotelManagementService,
    TenantDefaultDataService,
  ],
})
export class TenantsModule {}
