import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { DataExportService } from '../../../src/data-export/data-export.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { DATA_EXPORT_QUEUE, DATA_EXPORT_JOBS } from '../../../src/data-export/data-export.processor';

/**
 * Unit tests — DataExportService (PDPA Right to Access / Erasure)
 * S4-02 PDPA Test Coverage — S3-01
 */

const now = new Date();
const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

const mockExportRequest = {
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

const mockCompletedRequest = {
  ...mockExportRequest,
  status: 'completed',
  download_url: 'data:application/json;base64,abc123',
  download_expires_at: future,
  byte_size: 1024,
  completed_at: now,
};

function buildMockPrisma() {
  return {
    data_export_requests: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildMockQueue() {
  return {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
}

describe('DataExportService', () => {
  let service: DataExportService;
  let prisma: ReturnType<typeof buildMockPrisma>;
  let queue: ReturnType<typeof buildMockQueue>;

  beforeEach(async () => {
    prisma = buildMockPrisma();
    queue = buildMockQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(DATA_EXPORT_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<DataExportService>(DataExportService);
  });

  afterEach(() => jest.clearAllMocks());

  // ────────────────────────────────────────────────────────────
  // request()
  // ────────────────────────────────────────────────────────────
  describe('request()', () => {
    it('should create a queued export request and enqueue Bull job', async () => {
      prisma.data_export_requests.findFirst.mockResolvedValue(null);
      prisma.data_export_requests.create.mockResolvedValue(mockExportRequest);

      const result = await service.request({
        tenantId: 'tenant-1',
        userId: 'user-1',
        kind: 'export',
      });

      expect(prisma.data_export_requests.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 'tenant-1',
            requested_by_user_id: 'user-1',
            kind: 'export',
            status: 'queued',
          }),
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        DATA_EXPORT_JOBS.PROCESS_EXPORT,
        expect.objectContaining({
          requestId: mockExportRequest.id,
          tenantId: 'tenant-1',
          kind: 'export',
        }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(result).toEqual({ id: mockExportRequest.id, status: 'queued' });
    });

    it('should enqueue PROCESS_ERASURE job for erasure kind', async () => {
      prisma.data_export_requests.findFirst.mockResolvedValue(null);
      prisma.data_export_requests.create.mockResolvedValue({
        ...mockExportRequest,
        kind: 'erasure',
      });

      await service.request({ tenantId: 'tenant-1', kind: 'erasure' });

      expect(queue.add).toHaveBeenCalledWith(
        DATA_EXPORT_JOBS.PROCESS_ERASURE,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should default kind to "export" when not specified', async () => {
      prisma.data_export_requests.findFirst.mockResolvedValue(null);
      prisma.data_export_requests.create.mockResolvedValue(mockExportRequest);

      await service.request({ tenantId: 'tenant-1' });

      expect(prisma.data_export_requests.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'export' }),
        }),
      );
    });

    it('should throw BadRequestException when in-flight request exists', async () => {
      prisma.data_export_requests.findFirst.mockResolvedValue(mockExportRequest);

      await expect(
        service.request({ tenantId: 'tenant-1', kind: 'export' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.data_export_requests.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('should check rate limit per kind separately (export vs erasure)', async () => {
      // erasure request in-flight → should block only erasure, not export
      prisma.data_export_requests.findFirst
        .mockResolvedValueOnce({ ...mockExportRequest, kind: 'erasure', status: 'queued' });
      prisma.data_export_requests.create.mockResolvedValue(mockExportRequest);

      // ถ้า kind='export' ตรวจ findFirst ด้วย kind='export' จะได้ null
      prisma.data_export_requests.findFirst.mockResolvedValueOnce(null);

      // erasure จะ throw
      await expect(
        service.request({ tenantId: 'tenant-1', kind: 'erasure' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ────────────────────────────────────────────────────────────
  // listForTenant()
  // ────────────────────────────────────────────────────────────
  describe('listForTenant()', () => {
    it('should return requests for the given tenant', async () => {
      const requests = [mockExportRequest, { ...mockExportRequest, id: 'req-002' }];
      prisma.data_export_requests.findMany.mockResolvedValue(requests);

      const result = await service.listForTenant('tenant-1');

      expect(prisma.data_export_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1' },
          orderBy: { requested_at: 'desc' },
          take: 20,
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array when tenant has no requests', async () => {
      prisma.data_export_requests.findMany.mockResolvedValue([]);
      const result = await service.listForTenant('tenant-no-data');
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────
  // listAll()
  // ────────────────────────────────────────────────────────────
  describe('listAll()', () => {
    it('should list all requests with no filters', async () => {
      const requests = [mockExportRequest];
      prisma.data_export_requests.findMany.mockResolvedValue(requests);

      const result = await service.listAll({});

      expect(prisma.data_export_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { requested_at: 'desc' },
          take: 100,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by status when provided', async () => {
      prisma.data_export_requests.findMany.mockResolvedValue([]);

      await service.listAll({ status: 'completed' });

      const call = prisma.data_export_requests.findMany.mock.calls[0][0];
      expect(call.where.status).toBe('completed');
    });

    it('should filter by kind when provided', async () => {
      prisma.data_export_requests.findMany.mockResolvedValue([]);

      await service.listAll({ kind: 'erasure' });

      const call = prisma.data_export_requests.findMany.mock.calls[0][0];
      expect(call.where.kind).toBe('erasure');
    });

    it('should respect custom limit', async () => {
      prisma.data_export_requests.findMany.mockResolvedValue([]);

      await service.listAll({ limit: 10 });

      const call = prisma.data_export_requests.findMany.mock.calls[0][0];
      expect(call.take).toBe(10);
    });
  });

  // ────────────────────────────────────────────────────────────
  // complete()
  // ────────────────────────────────────────────────────────────
  describe('complete()', () => {
    it('should update request as completed with download URL', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue(mockExportRequest);
      prisma.data_export_requests.update.mockResolvedValue(mockCompletedRequest);

      await service.complete('req-001', 'data:application/json;base64,xyz', 512, future);

      expect(prisma.data_export_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-001' },
          data: expect.objectContaining({
            status: 'completed',
            download_url: 'data:application/json;base64,xyz',
            byte_size: 512,
            download_expires_at: future,
          }),
        }),
      );
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.complete('no-id', 'url', 100, future),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set completed_at to current date', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue(mockExportRequest);
      prisma.data_export_requests.update.mockResolvedValue(mockCompletedRequest);

      const before = new Date();
      await service.complete('req-001', 'url', 100, future);
      const after = new Date();

      const updateData = prisma.data_export_requests.update.mock.calls[0][0].data;
      expect(updateData.completed_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updateData.completed_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ────────────────────────────────────────────────────────────
  // fail()
  // ────────────────────────────────────────────────────────────
  describe('fail()', () => {
    it('should update request status to failed with error message', async () => {
      prisma.data_export_requests.update.mockResolvedValue({});

      await service.fail('req-001', 'DB connection timeout');

      expect(prisma.data_export_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-001' },
          data: expect.objectContaining({
            status: 'failed',
            error_message: 'DB connection timeout',
          }),
        }),
      );
    });

    it('should set completed_at when failing', async () => {
      prisma.data_export_requests.update.mockResolvedValue({});

      const before = new Date();
      await service.fail('req-001', 'error');
      const after = new Date();

      const updateData = prisma.data_export_requests.update.mock.calls[0][0].data;
      expect(updateData.completed_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updateData.completed_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  // ────────────────────────────────────────────────────────────
  // getDownloadUrl()
  // ────────────────────────────────────────────────────────────
  describe('getDownloadUrl()', () => {
    it('should return download URL for completed request', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue(mockCompletedRequest);

      const url = await service.getDownloadUrl('req-001', 'tenant-1');
      expect(url).toBe(mockCompletedRequest.download_url);
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue(null);

      await expect(service.getDownloadUrl('no-id', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when tenantId does not match', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue({
        ...mockCompletedRequest,
        tenant_id: 'tenant-1',
      });

      await expect(
        service.getDownloadUrl('req-001', 'tenant-other'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when status is not completed', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue({
        ...mockExportRequest,
        tenant_id: 'tenant-1',
        status: 'queued',
      });

      await expect(service.getDownloadUrl('req-001', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when download URL is missing', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue({
        ...mockCompletedRequest,
        download_url: null,
      });

      await expect(service.getDownloadUrl('req-001', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when download link has expired', async () => {
      const pastDate = new Date(Date.now() - 1000); // 1 second ago
      prisma.data_export_requests.findUnique.mockResolvedValue({
        ...mockCompletedRequest,
        download_expires_at: pastDate,
      });

      await expect(service.getDownloadUrl('req-001', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return URL when expiry date is in the future', async () => {
      prisma.data_export_requests.findUnique.mockResolvedValue({
        ...mockCompletedRequest,
        download_expires_at: future,
      });

      const url = await service.getDownloadUrl('req-001', 'tenant-1');
      expect(url).toBeTruthy();
    });
  });
});
