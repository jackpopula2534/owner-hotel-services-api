import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../prisma/prisma.module';
import { DataExportService } from './data-export.service';
import { DataExportController } from './data-export.controller';
import { DataExportProcessor } from './data-export.processor';
import { DATA_EXPORT_QUEUE } from './data-export.constants';

/**
 * DataExportModule — PDPA Right to Access / Right to Erasure (S3-01)
 *
 * Bull queue 'data-export' ประมวลผล export/erasure request แบบ async
 * ไม่ block HTTP response — tenant ได้รับ requestId ทันที
 */
@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: DATA_EXPORT_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    }),
  ],
  controllers: [DataExportController],
  providers: [DataExportService, DataExportProcessor],
  exports: [DataExportService],
})
export class DataExportModule {}
