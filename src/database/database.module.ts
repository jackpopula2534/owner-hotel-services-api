import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantCredit } from '../tenants/entities/tenant-credit.entity';
import { Plan } from '../plans/entities/plan.entity';
import { Feature } from '../features/entities/feature.entity';
import { PlanFeature } from '../plan-features/entities/plan-feature.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { BillingHistory } from '../subscriptions/entities/billing-history.entity';
import { SubscriptionFeature } from '../subscription-features/entities/subscription-feature.entity';
import { SubscriptionFeatureLogs } from '../subscription-features/entities/subscription-feature-log.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceAdjustment } from '../invoices/entities/invoice-adjustment.entity';
import { InvoiceItem } from '../invoice-items/entities/invoice-item.entity';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentRefund } from '../payments/entities/payment-refund.entity';
import { Admin } from '../admins/entities/admin.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get('DB_PORT', 3306),
        username: configService.get('DB_USERNAME', 'root'),
        password: configService.get('DB_PASSWORD', 'root'),
        database: configService.get('DB_DATABASE', 'hotel_services_db'),
        entities: [
          Tenant,
          TenantCredit,
          Plan,
          Feature,
          PlanFeature,
          Subscription,
          BillingHistory,
          SubscriptionFeature,
          SubscriptionFeatureLogs,
          Invoice,
          InvoiceAdjustment,
          InvoiceItem,
          Payment,
          PaymentRefund,
          Admin,
        ],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development' 
          ? ['error', 'warn', 'schema'] 
          : false,
        // ระบุ database เพื่อหลีกเลี่ยงการ query system tables
        extra: {
          // ปิดการ query metadata table
          connectionLimit: 10,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}

