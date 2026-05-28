import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { ChurnPredictionService } from './churn-prediction.service';
import { SmartSegmentationService } from './smart-segmentation.service';

/**
 * Nightly batch jobs for AI insights.
 * Runs once per day at 03:00 server time — light enough for daily cadence.
 */
@Injectable()
export class AiScheduler {
  private readonly logger = new Logger(AiScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly churn: ChurnPredictionService,
    private readonly segmentation: SmartSegmentationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async nightly(): Promise<void> {
    try {
      const tenants = await this.prisma.tenants.findMany({
        select: { id: true },
        take: 5_000,
      });

      let totalChurn = 0;
      let totalSegmentChanges = 0;
      for (const tenant of tenants) {
        totalChurn += await this.churn.recomputeForTenant(tenant.id);
        totalSegmentChanges += await this.segmentation.recomputeForTenant(tenant.id);
      }
      this.logger.log(
        `Nightly AI batch · ${tenants.length} tenant(s) · ${totalChurn} churn scored · ${totalSegmentChanges} segment changes`,
      );
    } catch (error: unknown) {
      this.logger.error(`Nightly AI batch failed: ${(error as Error).message}`);
    }
  }
}
