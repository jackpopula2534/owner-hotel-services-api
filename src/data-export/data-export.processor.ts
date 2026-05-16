import { Processor, Process, OnQueueError, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { DataExportService } from './data-export.service';
import { DATA_EXPORT_QUEUE, DATA_EXPORT_JOBS, DataExportJobData } from './data-export.constants';

/**
 * DataExportProcessor — Bull Queue Worker (S3-01)
 *
 * PDPA Right to Access (มาตรา 30) — เจ้าของข้อมูลมีสิทธิ์
 * ขอสำเนาข้อมูลส่วนบุคคลของตนเองได้
 *
 * Flow:
 *   1. Tenant POST /data-export → service.request() → บันทึก DB, queue job
 *   2. Processor.handleExport() รัน → รวบรวม PII ทุก table → JSON
 *   3. service.complete() → บันทึก download_url ลง DB
 *   4. Tenant GET /data-export/:id/download → รับ signed URL
 *
 * Queue: 'data-export'
 * Job names: 'process-export' | 'process-erasure'
 */


@Processor(DATA_EXPORT_QUEUE)
export class DataExportProcessor {
  private readonly logger = new Logger(DataExportProcessor.name);
  private lastQueueErrorLog = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly exportService: DataExportService,
  ) {}

  @OnQueueError()
  onError(error: Error) {
    const now = Date.now();
    const isConnErr =
      error.name === 'AggregateError' ||
      (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';
    if (isConnErr) {
      if (now - this.lastQueueErrorLog < 30_000) return;
      this.lastQueueErrorLog = now;
      this.logger.warn('DataExport queue: Redis unavailable — jobs will retry on reconnect.');
      return;
    }
    this.logger.error(`Queue error: ${error.message}`, error.stack);
  }

  @OnQueueFailed()
  async onFailed(job: Job<DataExportJobData>, error: Error) {
    this.logger.error(
      `Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
    try {
      await this.exportService.fail(job.data.requestId, error.message);
    } catch (e) {
      this.logger.error(`Could not mark request ${job.data.requestId} as failed: ${e}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Job: process-export — รวบรวมข้อมูลส่ง JSON (Right to Access)
  // ────────────────────────────────────────────────────────────
  @Process(DATA_EXPORT_JOBS.PROCESS_EXPORT)
  async handleExport(job: Job<DataExportJobData>): Promise<void> {
    const { requestId, tenantId } = job.data;
    this.logger.log(`Processing data export: request=${requestId} tenant=${tenantId}`);

    // Mark processing
    await (this.prisma as any).data_export_requests.update({
      where: { id: requestId },
      data: { status: 'processing' },
    });

    try {
      // ── รวบรวมข้อมูลทุก table ที่มี PII ─────────────────────
      const [guests, bookings, employees, users] = await Promise.all([
        this.collectGuests(tenantId),
        this.collectBookings(tenantId),
        this.collectEmployees(tenantId),
        this.collectUsers(tenantId),
      ]);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        tenantId,
        pdpa: {
          basis: 'Right to Access — PDPA มาตรา 30',
          retentionPolicy: {
            guests: '5 years',
            employees: '7 years',
            bookings: '5 years',
          },
        },
        data: { guests, bookings, employees, users },
      };

      // ── แปลงเป็น JSON Buffer แล้วสร้าง "URL" ─────────────────
      // NOTE: Production ควร upload ไป S3 แล้วสร้าง signed URL
      // ตอนนี้ encode เป็น data URI เพื่อให้ downloadable ได้ทันที
      const jsonString = JSON.stringify(exportPayload, null, 2);
      const byteSize = Buffer.byteLength(jsonString, 'utf8');

      // Placeholder URL — production จะเป็น S3 signed URL
      // เก็บเป็น base64 data URI สำหรับ dev/staging
      const dataUri = `data:application/json;base64,${Buffer.from(jsonString).toString('base64')}`;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // หมดอายุใน 7 วัน

      await this.exportService.complete(requestId, dataUri, byteSize, expiresAt);
      this.logger.log(
        `Export complete: request=${requestId} size=${byteSize}B expires=${expiresAt.toISOString()}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.exportService.fail(requestId, msg);
      throw error; // re-throw เพื่อให้ Bull retry
    }
  }

  // ────────────────────────────────────────────────────────────
  // Job: process-erasure — Right to Erasure (มาตรา 33)
  // ────────────────────────────────────────────────────────────
  @Process(DATA_EXPORT_JOBS.PROCESS_ERASURE)
  async handleErasure(job: Job<DataExportJobData>): Promise<void> {
    const { requestId, tenantId } = job.data;
    this.logger.log(`Processing erasure request: request=${requestId} tenant=${tenantId}`);

    await (this.prisma as any).data_export_requests.update({
      where: { id: requestId },
      data: { status: 'processing' },
    });

    try {
      // Anonymize all guests + employees for this tenant
      const [guestCount, employeeCount] = await Promise.all([
        this.anonymizeTenantGuests(tenantId),
        this.anonymizeTenantEmployees(tenantId),
      ]);

      const summary = {
        erasedAt: new Date().toISOString(),
        tenantId,
        guestsAnonymized: guestCount,
        employeesAnonymized: employeeCount,
      };

      const json = JSON.stringify(summary, null, 2);
      const byteSize = Buffer.byteLength(json, 'utf8');
      const dataUri = `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await this.exportService.complete(requestId, dataUri, byteSize, expiresAt);
      this.logger.log(
        `Erasure complete: tenant=${tenantId} guests=${guestCount} employees=${employeeCount}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.exportService.fail(requestId, msg);
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────
  // Private helpers — collect PII per table
  // ────────────────────────────────────────────────────────────

  private async collectGuests(tenantId: string) {
    return this.prisma.guest.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        nationality: true,
        dateOfBirth: true,
        address: true,
        consentGiven: true,
        consentAt: true,
        consentVersion: true,
        anonymizedAt: true,
        createdAt: true,
      },
    });
  }

  private async collectBookings(tenantId: string) {
    return this.prisma.booking.findMany({
      where: { tenantId },
      select: {
        id: true,
        guestFirstName: true,
        guestLastName: true,
        guestEmail: true,
        checkIn: true,
        checkOut: true,
        status: true,
        totalPrice: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500, // cap สำหรับ large tenants
    });
  }

  private async collectEmployees(tenantId: string) {
    return (this.prisma as any).employee.findMany({
      where: { tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        employeeCode: true,
        department: true,
        position: true,
        startDate: true,
        consentGiven: true,
        consentAt: true,
        consentVersion: true,
        anonymizedAt: true,
        createdAt: true,
        // ไม่รวม: bankAccount, nationalId, taxId, socialSecurity
        // (sensitive — แยก export เฉพาะกิจสำหรับ HR เท่านั้น)
      },
    });
  }

  private async collectUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Erasure helpers
  // ────────────────────────────────────────────────────────────

  private async anonymizeTenantGuests(tenantId: string): Promise<number> {
    const guests = await (this.prisma.guest as any).findMany({
      where: { tenantId, anonymizedAt: null },
      select: { id: true },
    });

    const REDACTED = '[REDACTED]';
    for (const g of guests) {
      await (this.prisma.guest as any).update({
        where: { id: g.id },
        data: {
          firstName: REDACTED, lastName: REDACTED,
          email: 'redacted@anonymized.invalid', phone: '0000000000',
          nationalId: null, passportNumber: null,
          dateOfBirth: null, address: null,
          city: null, country: null, postalCode: null,
          vehiclePlateNumber: null, specialNotes: null, vipLevel: null,
          anonymizedAt: new Date(),
        },
      });
    }
    return guests.length;
  }

  private async anonymizeTenantEmployees(tenantId: string): Promise<number> {
    const employees = await (this.prisma as any).employee.findMany({
      where: { tenantId, anonymizedAt: null },
      select: { id: true },
    });

    const REDACTED = '[REDACTED]';
    for (const e of employees) {
      await (this.prisma as any).employee.update({
        where: { id: e.id },
        data: {
          firstName: REDACTED, lastName: REDACTED,
          email: 'redacted@anonymized.invalid', phone: '0000000000',
          nationalId: null, bankAccount: null, bankName: null,
          socialSecurity: null, taxId: null,
          dateOfBirth: null, address: null,
          emergencyContacts: null, educations: null,
          workExperiences: null, notes: null, nickname: null,
          status: 'ANONYMIZED', anonymizedAt: new Date(),
        },
      });
    }
    return employees.length;
  }
}
