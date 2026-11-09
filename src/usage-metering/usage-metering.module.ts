import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { UsageMeteringService } from './usage-metering.service';
import { UsageMeteringController } from './usage-metering.controller';
import { UsageQuotaGuard } from './usage-quota.guard';
import { OverageBillingService } from './overage-billing.service';

@Module({
  imports: [PrismaModule, ConfigModule, EmailModule, ScheduleModule.forRoot()],
  controllers: [UsageMeteringController],
  providers: [UsageMeteringService, UsageQuotaGuard, OverageBillingService],
  exports: [UsageMeteringService, UsageQuotaGuard, OverageBillingService],
})
export class UsageMeteringModule {}
