import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { DATA_EXPORT_QUEUE, DATA_EXPORT_JOBS } from './data-export.constants';

export type ExportKind = 'export' | 'erasure';

export interface RequestExportInput {
  tenantId: string;
  userId?: string;
  kind?: ExportKind;
}

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DATA_EXPORT_QUEUE) private readonly exportQueue: Queue,
  ) {}

  /**
   * Tenant requests a data export/erasure.
   * Returns immediately with a queued request id.
   * Bull worker (DataExportProcessor) does the actual work asynchronously.
   *
   * Self-service rate-limit: only one in-flight request per tenant per kind per 24h.
   */
  async request(input: RequestExportInput): Promise<{ id: string; status: string }> {
    const kind: ExportKind = input.kind || 'export';

    const recent = await (this.prisma as any).data_export_requests.findFirst({
      where: {
        tenant_id: input.tenantId,
        kind: kind as any,
        status: { in: ['queued', 'processing'] as any },
      },
    });
    if (recent) {
      throw new BadRequestException('มีคำขอกำลังดำเนินการอยู่ กรุณารอจนเสร็จก่อนสร้างคำขอใหม่');
    }

    const exportRequest = await (this.prisma as any).data_export_requests.create({
      data: {
        tenant_id: input.tenantId,
        requested_by_user_id: input.userId,
        kind: kind as any,
        status: 'queued' as any,
      },
    });

    // ── Enqueue Bull job สำหรับ actual processing ──────────────
    const jobName =
      kind === 'erasure'
        ? DATA_EXPORT_JOBS.PROCESS_ERASURE
        : DATA_EXPORT_JOBS.PROCESS_EXPORT;

    await this.exportQueue.add(
      jobName,
      {
        requestId: exportRequest.id,
        tenantId: input.tenantId,
        userId: input.userId,
        kind,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    this.logger.log(
      `Data ${kind} queued: tenant=${input.tenantId} request=${exportRequest.id}`,
    );

    return { id: exportRequest.id, status: exportRequest.status };
  }

  /**
   * List recent requests for a tenant (self-service history).
   */
  async listForTenant(tenantId: string) {
    return (this.prisma as any).data_export_requests.findMany({
      where: { tenant_id: tenantId },
      orderBy: { requested_at: 'desc' },
      take: 20,
    });
  }

  /**
   * Admin endpoint: list across all tenants for compliance audit.
   */
  async listAll(filters: {
    status?: 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
    kind?: ExportKind;
    limit?: number;
  }) {
    return (this.prisma as any).data_export_requests.findMany({
      where: {
        ...(filters.status && { status: filters.status as any }),
        ...(filters.kind && { kind: filters.kind as any }),
      },
      orderBy: { requested_at: 'desc' },
      take: filters.limit || 100,
    });
  }

  /**
   * Mark request as completed (called by background worker after upload).
   * `downloadUrl` is a signed S3 URL; we record `download_expires_at` so
   * the cleanup cron can stop offering it after 7 days.
   */
  async complete(requestId: string, downloadUrl: string, byteSize: number, expiresAt: Date) {
    const r = await (this.prisma as any).data_export_requests.findUnique({
      where: { id: requestId },
    });
    if (!r) throw new NotFoundException('Request not found');

    await (this.prisma as any).data_export_requests.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        download_url: downloadUrl,
        download_expires_at: expiresAt,
        byte_size: byteSize,
        completed_at: new Date(),
      },
    });
  }

  async fail(requestId: string, error: string) {
    await (this.prisma as any).data_export_requests.update({
      where: { id: requestId },
      data: { status: 'failed', error_message: error, completed_at: new Date() },
    });
  }

  /**
   * Tenant downloads — returns the signed URL if still valid.
   */
  async getDownloadUrl(requestId: string, tenantId: string): Promise<string> {
    const r = await (this.prisma as any).data_export_requests.findUnique({
      where: { id: requestId },
    });
    if (!r) throw new NotFoundException('Request not found');
    if (r.tenant_id !== tenantId) {
      throw new ForbiddenException("Cannot access another tenant's export");
    }
    if (r.status !== 'completed') {
      throw new BadRequestException('Export is not yet ready');
    }
    if (
      !r.download_url ||
      (r.download_expires_at && new Date(r.download_expires_at) < new Date())
    ) {
      throw new BadRequestException('Download link has expired');
    }
    return r.download_url;
  }
}
