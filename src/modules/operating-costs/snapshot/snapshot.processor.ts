import { OnQueueError, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { OperatingCostsService } from '../operating-costs.service';
import {
  OPCOST_SNAPSHOT_JOBS,
  OPCOST_SNAPSHOT_QUEUE,
  type RegenerateMonthlyJobData,
} from './snapshot.constants';

/**
 * Bull Queue Worker สำหรับ regenerate operating-cost monthly snapshots
 *
 * Triggered by:
 *   - Cron schedule (snapshot.scheduler.ts) → ทุกต้นเดือน + ทุกวัน
 *   - Manual API → POST /admin/operating-costs/snapshots/trigger
 *
 * Idempotent: ใช้ upsert ใน service.regenerateSnapshots()
 *             ฉะนั้นรันซ้ำได้ไม่ทำให้ข้อมูลพัง
 */
@Processor(OPCOST_SNAPSHOT_QUEUE)
export class SnapshotProcessor {
  private readonly logger = new Logger(SnapshotProcessor.name);
  private lastQueueErrorLog = 0;

  constructor(private readonly opCostsService: OperatingCostsService) {}

  @OnQueueError()
  onError(error: Error) {
    const now = Date.now();
    const isConnErr =
      error.name === 'AggregateError' ||
      (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';
    if (isConnErr) {
      // Redis ไม่พร้อม — log แค่ครั้งเดียวต่อ 30s กัน spam
      if (now - this.lastQueueErrorLog < 30_000) return;
      this.lastQueueErrorLog = now;
      this.logger.warn(
        'OpCost snapshot queue: Redis unavailable — jobs will retry on reconnect.',
      );
      return;
    }
    this.logger.error(`Snapshot queue error: ${error.message}`, error.stack);
  }

  @OnQueueFailed()
  async onFailed(job: Job<RegenerateMonthlyJobData>, error: Error) {
    this.logger.error(
      `Snapshot job ${job.id} failed (year=${job.data.year}, month=${job.data.month}, attempt ${job.attemptsMade}): ${error.message}`,
    );
  }

  @Process(OPCOST_SNAPSHOT_JOBS.REGENERATE_MONTHLY)
  async handleRegenerate(job: Job<RegenerateMonthlyJobData>): Promise<{
    year: number;
    month: number;
    total: number;
    created: number;
    updated: number;
    durationMs: number;
  }> {
    const start = Date.now();
    const { year, month, trigger, triggeredBy } = job.data;
    this.logger.log(
      `→ Regenerating snapshots for ${year}-${String(month).padStart(2, '0')} (trigger=${trigger}${triggeredBy ? `, by=${triggeredBy}` : ''})`,
    );

    try {
      const result = await this.opCostsService.regenerateSnapshots(year, month);
      const durationMs = Date.now() - start;
      this.logger.log(
        `✓ Snapshots done for ${year}-${String(month).padStart(2, '0')}: ${result.created} created, ${result.updated} updated, ${result.total} expenses (${durationMs}ms)`,
      );
      return { ...result, durationMs };
    } catch (err: any) {
      this.logger.error(
        `✗ Snapshot regeneration failed for ${year}-${month}: ${err?.message}`,
      );
      throw err; // let Bull retry
    }
  }
}
