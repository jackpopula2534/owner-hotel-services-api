import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SaasAnalyticsService } from './saas-analytics.service';
import { AdminAnalyticsController } from './admin-analytics.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAnalyticsController],
  providers: [SaasAnalyticsService],
  exports: [SaasAnalyticsService],
})
export class AdminAnalyticsModule {}
