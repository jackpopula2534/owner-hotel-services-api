import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SentimentService } from './sentiment.service';
import { ChurnPredictionService } from './churn-prediction.service';
import { SmartSegmentationService } from './smart-segmentation.service';
import { AiScheduler } from './ai.scheduler';
import { AiEventListener } from './ai-event.listener';
import { AiController } from './ai.controller';

/**
 * CRM AI Insights — Phase 4
 *
 * - SentimentService: Thai+English rule-based polarity scoring
 * - ChurnPredictionService: rule-based risk score with daily cron
 * - SmartSegmentationService: RFM-based auto-segmentation
 * - AiScheduler: nightly batch (03:00) recomputes churn + segments per tenant
 * - AiEventListener: real-time sentiment on review.submitted
 */
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [AiController],
  providers: [
    SentimentService,
    ChurnPredictionService,
    SmartSegmentationService,
    AiScheduler,
    AiEventListener,
  ],
  exports: [SentimentService, ChurnPredictionService, SmartSegmentationService],
})
export class CrmAiModule {}
