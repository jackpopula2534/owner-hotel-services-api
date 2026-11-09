import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bull';
import {
  OPCOST_SNAPSHOT_JOBS,
  OPCOST_SNAPSHOT_QUEUE,
  type RegenerateMonthlyJobData,
} from './snapshot.constants';

/**
 * Schedule snapshot regeneration jobs
 *
 * 2 schedules:
 *   1. Monthly @ 02:00 ของวันที่ 1 → regenerate snapshots ของ "เดือนที่แล้ว"
 *      → ทำให้รายงานเดือนที่แล้ว fix แน่นอน
 *
 *   2. Daily @ 03:00 → regenerate snapshots ของ "เดือนปัจจุบัน"
 *      → ทำให้รายงานเดือนนี้ up-to-date หาก expense ถูกแก้กลางเดือน
 *
 * วิธี enqueue:
 *   - ใช้ Bull job เพื่อ retry ได้ ถ้า Redis ไม่พร้อมตอนนั้น
 *   - removeOnComplete: เก็บ 30 jobs ล่าสุด
 *   - attempts: 3 retry พร้อม exponential backoff
 *
 * Trigger manually:
 *   POST /admin/operating-costs/snapshots/trigger
 *   หรือเรียก SnapshotSchedulerService.enqueueManual()
 */
@Injectable()
export class SnapshotScheduler implements OnModuleInit {
  private readonly logger = new Logger(SnapshotScheduler.name);

  constructor(
    @InjectQueue(OPCOST_SNAPSHOT_QUEUE)
    private readonly queue: Queue<RegenerateMonthlyJobData>,
  ) {}

  async onModuleInit() {
    // Log status เพื่อช่วย debug
    try {
      const counts = await this.queue.getJobCounts();
      this.logger.log(
        `OpCost snapshot queue initialized · waiting=${counts.waiting} active=${counts.active} delayed=${counts.delayed}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `OpCost snapshot queue: cannot inspect (${err?.message || 'Redis unreachable'})`,
      );
    }
  }

  /**
   * ทุกวันที่ 1 ของเดือน เวลา 02:00 (Asia/Bangkok)
   * → regenerate snapshots ของเดือนที่แล้ว
   * cron: 'minute hour day month dow' → 0 2 1 * *
   */
  @Cron('0 2 1 * *', {
    name: 'opcost-snapshot-monthly',
    timeZone: 'Asia/Bangkok',
  })
  async runMonthly() {
    // คำนวณ "เดือนที่แล้ว"
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prev.getFullYear();
    const month = prev.getMonth() + 1;
    this.logger.log(
      `[CRON monthly] Scheduling snapshot regen for ${year}-${String(month).padStart(2, '0')} (previous month)`,
    );
    await this.enqueue({ year, month, trigger: 'cron-monthly' });
  }

  /**
   * ทุกวันเวลา 03:00 (Asia/Bangkok)
   * → regenerate snapshots ของเดือนปัจจุบัน เพื่อให้รายงาน up-to-date
   * cron: '0 3 * * *'
   */
  @Cron('0 3 * * *', {
    name: 'opcost-snapshot-daily',
    timeZone: 'Asia/Bangkok',
  })
  async runDaily() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    this.logger.log(
      `[CRON daily] Refreshing snapshots for current month ${year}-${String(month).padStart(2, '0')}`,
    );
    await this.enqueue({ year, month, trigger: 'cron-daily' });
  }

  /**
   * Enqueue snapshot regeneration job
   * - ใช้ jobId เพื่อ dedupe (idempotent — รัน parallel ไม่ซ้อน)
   */
  async enqueue(data: RegenerateMonthlyJobData) {
    const jobId = `${data.trigger}-${data.year}-${data.month}`;
    try {
      await this.queue.add(OPCOST_SNAPSHOT_JOBS.REGENERATE_MONTHLY, data, {
        jobId, // dedupe — job เดียวกันจะ skip ถ้ามีอยู่
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 30,
        removeOnFail: 10,
      });
      this.logger.log(`✓ Enqueued snapshot job ${jobId}`);
    } catch (err: any) {
      this.logger.error(`✗ Failed to enqueue snapshot job ${jobId}: ${err?.message}`);
      throw err;
    }
  }

  /** Trigger manually จาก endpoint */
  async enqueueManual(year: number, month: number, triggeredBy?: string) {
    // สำหรับ manual ให้ใส่ timestamp ใน jobId เพื่อไม่ dedupe กับ cron
    const jobId = `manual-${year}-${month}-${Date.now()}`;
    return this.queue.add(
      OPCOST_SNAPSHOT_JOBS.REGENERATE_MONTHLY,
      { year, month, trigger: 'manual', triggeredBy },
      {
        jobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 30,
        removeOnFail: 10,
      },
    );
  }

  /** สถานะ queue สำหรับ admin endpoint */
  async getQueueStatus() {
    try {
      const [counts, recentCompleted, recentFailed] = await Promise.all([
        this.queue.getJobCounts(),
        this.queue.getCompleted(0, 9),
        this.queue.getFailed(0, 9),
      ]);
      return {
        queue: OPCOST_SNAPSHOT_QUEUE,
        counts,
        recentCompleted: recentCompleted.map((j) => ({
          id: j.id,
          data: j.data,
          returnvalue: j.returnvalue,
          finishedOn: j.finishedOn,
          processedOn: j.processedOn,
        })),
        recentFailed: recentFailed.map((j) => ({
          id: j.id,
          data: j.data,
          failedReason: j.failedReason,
          attemptsMade: j.attemptsMade,
          finishedOn: j.finishedOn,
        })),
      };
    } catch (err: any) {
      return {
        queue: OPCOST_SNAPSHOT_QUEUE,
        error: err?.message || 'Redis unreachable',
        counts: null,
      };
    }
  }
}
