/**
 * Constants สำหรับ Snapshot Background Job
 *
 * Queue: 'opcost-snapshot'
 * - Job: regenerate-monthly — สร้าง/refresh snapshots ของเดือนที่ระบุ
 *
 * Schedule:
 * - รันทุกวันที่ 1 ของเดือน เวลา 02:00 → regenerate snapshots ของเดือนที่แล้ว
 *   (cron: '0 2 1 * *' — minute hour day month dow)
 * - รันทุกวันเวลา 03:00 → refresh snapshots ของเดือนปัจจุบัน
 *   (cron: '0 3 * * *' — keep current month up-to-date หาก expense ถูกแก้)
 */

export const OPCOST_SNAPSHOT_QUEUE = 'opcost-snapshot';

export const OPCOST_SNAPSHOT_JOBS = {
  REGENERATE_MONTHLY: 'regenerate-monthly',
} as const;

export interface RegenerateMonthlyJobData {
  year: number;
  month: number;
  trigger: 'cron-monthly' | 'cron-daily' | 'manual';
  /** ผู้ trigger (ถ้า manual) */
  triggeredBy?: string;
}
