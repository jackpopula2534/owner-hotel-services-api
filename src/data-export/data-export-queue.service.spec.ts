import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { DataExportService } from './data-export.service';
import { PrismaService } from '../prisma/prisma.service';
import { DATA_EXPORT_QUEUE, DATA_EXPORT_JOBS } from './data-export.processor';

/**
 * Unit tests — DataExportService (Bull Queue integration)
 * S4-02 PDPA Test Coverage — S3-01
 *
 * Tests the Bull queue enqueue behaviour on top of the basic
 * data-export.service.spec.ts (which mocks queue away).
 */

const now = new Date();
const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

const baseRequest = {
  id: 'req-001',
  tenant_id: 'tenant-1',
  requested_by_user_id: 'user-1',
  kind: 'export',
  status: 'queued',
  download_url: null,
  download_expires_at: null,
  byte_size: null,
  requested_at: now,
  completed_at: null,
  error_message: null,
};

describe('DataExportService — Bull Queue integration', () => {
  let service: DataExportService;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      data_export_requests: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(baseRequest),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(DATA_EXPORT_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<DataExportService>(DataExportService);
  });

  afterEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────────────────────
  // request() — queue enqueue behaviour
  // ──────────────────────────────────────────────────────────────
  describe('request() — queue enqueue', () => {
    it('should enqueue PROCESS_EXPORT job for export kind', async () => {
      await service.request({ tenantId: 'tenant-1', userId: 'user-1', kind: 'export' });

      expect(mockQueue.add).toHaveBeenCalledWith(
        DATA_EXPORT_JOBS.PROCESS_EXPORT,
        expect.objectContaining({
          requestId: baseRequest.id,
          tenantId: 'tenant-1',
          userId: 'user-1',
          kind: 'export',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        }),
      );
    });

    it('should enqueue PROCESS_ERASURE job for erasure kind', async () => {
      mockPrisma.data_export_requests.create.mockResolvedValue({
        ...baseRequest,
        kind: 'erasure',
      });

      await service.request({ tenantId: 'tenant-1', kind: 'erasure' });

      expect(mockQueue.add).toHaveBeenCalledWith(
        DATA_EXPORT_JOBS.PROCESS_ERASURE,
        expect.objectContaining({ kind: 'erasure' }),
        expect.any(Object),
      );
    });

    it('should NOT enqueue when rate-limited (in-flight request exists)', async () => {
      mockPrisma.data_export_requests.findFirst.mockResolvedValue({
        ...baseRequest,
        status: 'processing',
      });

      await expect(
        service.request({ tenantId: 'tenant-1', kind: 'export' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('should create DB record before enqueuing (DB-first pattern)', async () => {
      const callOrder: string[] = [];
      mockPrisma.data_export_requests.create.mockImplementation(async (args: any) => {
        callOrder.push('db-create');
        return baseRequest;
      });
      mockQueue.add.mockImplementation(async () => {
        callOrder.push('queue-add');
        return { id: 'job-1' };
      });

      await service.request({ tenantId: 'tenant-1', kind: 'export' });

      expect(callOrder).toEqual(['db-create', 'queue-add']);
    });

    it('should return id and queued status immediately', async () => {
      const result = await service.request({ tenantId: 'tenant-1' });
      expect(result).toEqual({ id: 'req-001', status: 'queued' });
    });

    it('should default kind to export when not specified', async () => {
      await service.request({ tenantId: 'tenant-1' });

      expect(mockPrisma.data_export_requests.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'export' }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        DATA_EXPORT_JOBS.PROCESS_EXPORT,
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // listForTenant()
  // ──────────────────────────────────────────────────────────────
  describe('listForTenant()', () => {
    it('should return last 20 requests ordered by requested_at desc', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        ...baseRequest,
        id: `req-${i}`,
      }));
      mockPrisma.data_export_requests.findMany.mockResolvedValue(requests);

      const result = await service.listForTenant('tenant-1');

      expect(mockPrisma.data_export_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1' },
          orderBy: { requested_at: 'desc' },
          take: 20,
        }),
      );
      expect(result).toHaveLength(3);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // listAll()
  // ──────────────────────────────────────────────────────────────
  describe('listAll()', () => {
    it('should apply status and kind filters', async () => {
      mockPrisma.data_export_requests.findMany.mockResolvedValue([]);
      await service.listAll({ status: 'completed', kind: 'export', limit: 50 });

      const call = mockPrisma.data_export_requests.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('completed');
      expect(call.where.kind).toBe('export');
      expect(call.take).toBe(50);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // complete() + fail()
  // ──────────────────────────────────────────────────────────────
  describe('complete()', () => {
    it('should update to completed status with download metadata', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue(baseRequest);

      await service.complete('req-001', 'data:application/json;base64,abc', 512, future);

      expect(mockPrisma.data_export_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-001' },
          data: expect.objectContaining({
            status: 'completed',
            download_url: 'data:application/json;base64,abc',
            download_expires_at: future,
            byte_size: 512,
          }),
        }),
      );
    });

    it('should throw NotFoundException when request not found', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue(null);
      await expect(service.complete('x', 'url', 100, future)).rejects.toThrow(NotFoundException);
    });
  });

  describe('fail()', () => {
    it('should update status to failed with error_message', async () => {
      await service.fail('req-001', 'Timeout error');

      expect(mockPrisma.data_export_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            error_message: 'Timeout error',
          }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getDownloadUrl() — tenant isolation + expiry
  // ──────────────────────────────────────────────────────────────
  describe('getDownloadUrl()', () => {
    it('should return URL for own completed non-expired request', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        status: 'completed',
        download_url: 'data:application/json;base64,xyz',
        download_expires_at: future,
      });

      const url = await service.getDownloadUrl('req-001', 'tenant-1');
      expect(url).toBe('data:application/json;base64,xyz');
    });

    it('should throw ForbiddenException for cross-tenant access', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        tenant_id: 'tenant-1',
        status: 'completed',
        download_url: 'x',
        download_expires_at: future,
      });

      await expect(service.getDownloadUrl('req-001', 'tenant-evil')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when link is expired', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        status: 'completed',
        download_url: 'x',
        download_expires_at: new Date(Date.now() - 1000),
      });

      await expect(service.getDownloadUrl('req-001', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for unknown requestId', async () => {
      mockPrisma.data_export_requests.findUnique.mockResolvedValue(null);
      await expect(service.getDownloadUrl('ghost-id', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
