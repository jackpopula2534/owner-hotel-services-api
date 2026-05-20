import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * AnonymizeService — Right to Erasure (PDPA มาตรา 33)
 *
 * แทนที่ PII ด้วย placeholder แทนการ hard delete
 * เพื่อรักษา referential integrity (Booking, Payroll, AuditLog ยังอ้างอิง ID ได้)
 * และปฏิบัติตาม PDPA "Right to be Forgotten"
 *
 * Sprint: S2-02
 */
@Injectable()
export class AnonymizeService {
  private readonly logger = new Logger(AnonymizeService.name);

  private static readonly REDACTED = '[REDACTED]';
  private static readonly REDACTED_EMAIL = 'redacted@anonymized.invalid';
  private static readonly REDACTED_PHONE = '0000000000';

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // Guest Anonymization
  // ────────────────────────────────────────────────────────────

  /**
   * Anonymize a guest record — แทนที่ PII ทั้งหมดด้วย [REDACTED]
   * Booking records ยังคงอยู่ แต่ชี้ไปหา anonymized guest
   */
  async anonymizeGuest(guestId: string, tenantId: string): Promise<void> {
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, tenantId },
    });

    if (!guest) {
      throw new NotFoundException(`Guest ${guestId} not found`);
    }

    if ((guest as any).anonymizedAt) {
      this.logger.warn(`Guest ${guestId} already anonymized — skipping`);
      return;
    }

    await (this.prisma.guest as any).update({
      where: { id: guestId },
      data: {
        firstName: AnonymizeService.REDACTED,
        lastName: AnonymizeService.REDACTED,
        email: AnonymizeService.REDACTED_EMAIL,
        phone: AnonymizeService.REDACTED_PHONE,
        nationalId: null,
        passportNumber: null,
        dateOfBirth: null,
        nationality: null,
        address: null,
        city: null,
        country: null,
        postalCode: null,
        vehiclePlateNumber: null,
        specialNotes: null,
        vipLevel: null,
        anonymizedAt: new Date(),
      },
    });

    this.logger.log(`Guest anonymized: id=${guestId} tenant=${tenantId}`);
  }

  // ────────────────────────────────────────────────────────────
  // Employee Anonymization
  // ────────────────────────────────────────────────────────────

  /**
   * Anonymize an employee record — แทนที่ PII ทั้งหมดด้วย [REDACTED]
   * Payroll / Attendance records ยังคงอยู่ แต่ไม่มีข้อมูลชื่อแล้ว
   */
  async anonymizeEmployee(employeeId: string, tenantId: string): Promise<void> {
    const employee = await (this.prisma as any).employee.findFirst({
      where: { id: employeeId, tenantId },
    });

    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    if (employee.anonymizedAt) {
      this.logger.warn(`Employee ${employeeId} already anonymized — skipping`);
      return;
    }

    await (this.prisma as any).employee.update({
      where: { id: employeeId },
      data: {
        firstName: AnonymizeService.REDACTED,
        lastName: AnonymizeService.REDACTED,
        email: AnonymizeService.REDACTED_EMAIL,
        phone: AnonymizeService.REDACTED_PHONE,
        nationalId: null,
        bankAccount: null,
        bankName: null,
        socialSecurity: null,
        taxId: null,
        dateOfBirth: null,
        address: null,
        emergencyContacts: null,
        educations: null,
        workExperiences: null,
        notes: null,
        nickname: null,
        status: 'ANONYMIZED',
        anonymizedAt: new Date(),
      },
    });

    this.logger.log(`Employee anonymized: id=${employeeId} tenant=${tenantId}`);
  }

  // ────────────────────────────────────────────────────────────
  // Bulk purge — Data Retention (S2-03)
  // ────────────────────────────────────────────────────────────

  /**
   * Anonymize guests ที่ไม่มี booking และเกิน retention period
   * เรียกโดย DataRetentionService cron job
   */
  async purgeExpiredGuests(retentionYears = 5): Promise<number> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - retentionYears);

    // หา guest ที่ไม่มี active booking และ createdAt เกิน retention
    const expired = await (this.prisma.guest as any).findMany({
      where: {
        createdAt: { lt: cutoff },
        anonymizedAt: null,
        bookings: { none: { checkOut: { gt: cutoff } } },
      },
      select: { id: true, tenantId: true },
    });

    let count = 0;
    for (const g of expired) {
      try {
        await this.anonymizeGuest(g.id, g.tenantId!);
        count++;
      } catch (err) {
        this.logger.error(`Failed to anonymize guest ${g.id}: ${err}`);
      }
    }

    this.logger.log(
      `Data retention purge: anonymized ${count} guests (cutoff=${cutoff.toISOString()})`,
    );
    return count;
  }

  /**
   * Anonymize employees ที่ลาออกแล้วและเกิน retention period
   */
  async purgeExpiredEmployees(retentionYears = 7): Promise<number> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - retentionYears);

    const expired = await (this.prisma as any).employee.findMany({
      where: {
        status: { in: ['RESIGNED', 'TERMINATED'] },
        updatedAt: { lt: cutoff },
        anonymizedAt: null,
      },
      select: { id: true, tenantId: true },
    });

    let count = 0;
    for (const e of expired) {
      try {
        await this.anonymizeEmployee(e.id, e.tenantId!);
        count++;
      } catch (err) {
        this.logger.error(`Failed to anonymize employee ${e.id}: ${err}`);
      }
    }

    this.logger.log(
      `Data retention purge: anonymized ${count} employees (cutoff=${cutoff.toISOString()})`,
    );
    return count;
  }
}
