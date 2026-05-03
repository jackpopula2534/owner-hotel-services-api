import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhooksService } from './webhooks.service';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [PrismaModule, ConfigModule, ScheduleModule.forRoot()],
  controllers: [WebhooksController],
  providers: [WebhooksService, PaymentReconciliationService],
  exports: [WebhooksService, PaymentReconciliationService],
})
export class WebhooksModule {}
