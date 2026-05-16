import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AnonymizeService } from './services/anonymize.service';
import { DataRetentionService } from './services/data-retention.service';

/**
 * DataRetentionModule — PDPA Data Retention cron jobs (S2-03)
 *
 * Register ใน AppModule เพื่อให้ cron jobs ทำงานอัตโนมัติ
 * ScheduleModule.forRoot() register อยู่ที่ AppModule แล้ว
 */
@Module({
  imports: [PrismaModule],
  providers: [AnonymizeService, DataRetentionService],
  exports: [DataRetentionService, AnonymizeService],
})
export class DataRetentionModule {}
