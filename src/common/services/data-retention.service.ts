import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AnonymizeService } from './anonymize.service';

/**
 * DataRetentionService — PDPA Data Retention Policy (S2-03)
 *
 * ตาม PDPA มาตรา 26 ผู้ควบคุมข้อมูลต้องลบ/ทำลายข้อมูล
 * เมื่อพ้นระยะเวลาที่จำเป็น หรือเมื่อหมดความจำเป็น
 *
 * Retention Periods:
 *   - Guest data:    5 ปี นับจาก last stay / created date
 *   - Employee data: 7 ปี นับจาก resignation/termination (กฎหมายแรงงาน)
 *   - Booking data:  5 ปี (อ้างอิง Revenue + Tax compliance)
 *   - Audit logs:    3 ปี
 *
 * Cron schedule:
 *   - ทุกคืน 02:00 น. — lightweight scan
 *   - ทุกวันอาทิตย์ 01:00 น. — full purge scan
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  // Retention periods in years (สามารถ override ผ่าน env ได้)
  private readonly GUEST_RETENTION_YEARS = Number(process.env.RETENTION_GUEST_YEARS) || 5;
  private readonly EMPLOYEE_RETENTION_YEARS = Number(process.env.RETENTION_EMPLOYEE_YEARS) || 7;

  constructor(private readonly anonymizeService: AnonymizeService) {}

  // ────────────────────────────────────────────────────────────
  // Scheduled Jobs
  // ────────────────────────────────────────────────────────────

  /**
   * รันทุกคืน 02:00 น. — purge guest records เกิน retention
   * ใช้ UTC เพื่อหลีกเลี่ยงปัญหา DST
   */
  @Cron('0 2 * * *', { name: 'guest-data-purge', timeZone: 'Asia/Bangkok' })
  async runGuestPurge(): Promise<void> {
    this.logger.log(
      `[DataRetention] Starting guest purge (retention=${this.GUEST_RETENTION_YEARS}y)`,
    );
    try {
      const count = await this.anonymizeService.purgeExpiredGuests(this.GUEST_RETENTION_YEARS);
      this.logger.log(`[DataRetention] Guest purge complete: ${count} records anonymized`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[DataRetention] Guest purge failed: ${msg}`);
    }
  }

  /**
   * รันทุกวันอาทิตย์ 01:00 น. — purge employee records เกิน retention
   * ทำ weekly เพราะ employee data เปลี่ยนน้อยกว่า guest
   */
  @Cron('0 1 * * 0', { name: 'employee-data-purge', timeZone: 'Asia/Bangkok' })
  async runEmployeePurge(): Promise<void> {
    this.logger.log(
      `[DataRetention] Starting employee purge (retention=${this.EMPLOYEE_RETENTION_YEARS}y)`,
    );
    try {
      const count = await this.anonymizeService.purgeExpiredEmployees(
        this.EMPLOYEE_RETENTION_YEARS,
      );
      this.logger.log(`[DataRetention] Employee purge complete: ${count} records anonymized`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[DataRetention] Employee purge failed: ${msg}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Manual Trigger (สำหรับ Admin / Testing)
  // ────────────────────────────────────────────────────────────

  /**
   * รัน full purge ทันที (เรียกจาก controller หรือ admin endpoint)
   * Returns summary of what was purged
   */
  async runFullPurgeNow(): Promise<{ guestsPurged: number; employeesPurged: number }> {
    this.logger.log('[DataRetention] Manual full purge triggered');

    const [guestsPurged, employeesPurged] = await Promise.all([
      this.anonymizeService.purgeExpiredGuests(this.GUEST_RETENTION_YEARS),
      this.anonymizeService.purgeExpiredEmployees(this.EMPLOYEE_RETENTION_YEARS),
    ]);

    this.logger.log(
      `[DataRetention] Manual purge done: guests=${guestsPurged} employees=${employeesPurged}`,
    );

    return { guestsPurged, employeesPurged };
  }

  /**
   * ดู retention policy ที่ใช้อยู่ปัจจุบัน
   */
  getRetentionPolicy(): {
    guest: { years: number; description: string };
    employee: { years: number; description: string };
    booking: { years: number; description: string };
    auditLog: { years: number; description: string };
  } {
    return {
      guest: {
        years: this.GUEST_RETENTION_YEARS,
        description: 'ข้อมูลแขก — นับจากวันที่ไม่มี active booking',
      },
      employee: {
        years: this.EMPLOYEE_RETENTION_YEARS,
        description: 'ข้อมูลพนักงาน — นับจากวันที่ลาออก/ถูกเลิกจ้าง (ตามกฎหมายแรงงาน)',
      },
      booking: {
        years: 5,
        description: 'ข้อมูลการจอง — เก็บไว้เพื่อ Revenue & Tax compliance',
      },
      auditLog: {
        years: 3,
        description: 'Audit logs — เก็บเพื่อ security review',
      },
    };
  }
}
