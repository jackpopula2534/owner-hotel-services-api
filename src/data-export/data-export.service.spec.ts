import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DataExportService', () => {
  let service: DataExportService;
  let mockFindFirst: jest.Mock;
  let mockFindUnique: jest.Mock;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;

  beforeEach(async () => {
    mockFindFirst = jest.fn();
    mockFindUnique = jest.fn();
    mockCreate = jest
      .fn()
      .mockImplementation(async ({ data }) => ({
        id: 'req-1',
        status: 'queued',
        ...data,
      }));
    mockUpdate = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportService,
        {
          provide: PrismaService,
          useValue: {
            data_export_requests: {
              findFirst: mockFindFirst,
              findUnique: mockFindUnique,
              findMany: jest.fn().mockResolvedValue([]),
              create: mockCreate,
              update: mockUpdate,
            },
          },
        },
      ],
    }).compile();

    service = module.get(DataExportService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('request', () => {
    it('queues a new export when none in flight', async () => {
      mockFindFirst.mockResolvedValue(null);
      const r = await service.request({ tenantId: 't1', userId: 'u1' });
      expect(r.id).toBe('req-1');
      expect(r.status).toBe('queued');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenant_id: 't1', kind: 'export' }),
        }),
      );
    });

    it('rejects when an in-flight request already exists', async () => {
      mockFindFirst.mockResolvedValue({ id: 'existing', status: 'processing' });
      await expect(service.request({ tenantId: 't1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('separates erasure from export queues', async () => {
      mockFindFirst.mockResolvedValue(null);
      const r = await service.request({ tenantId: 't1', kind: 'erasure' });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'erasure' }),
        }),
      );
      expect(r.status).toBe('queued');
    });
  });

  describe('getDownloadUrl', () => {
    it('returns signed URL for completed export of own tenant', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        tenant_id: 't1',
        status: 'completed',
        download_url: 'https://signed.example/x',
        download_expires_at: new Date(Date.now() + 3600_000),
      });
      expect(await service.getDownloadUrl('req-1', 't1')).toBe(
        'https://signed.example/x',
      );
    });

    it('rejects cross-tenant access', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        tenant_id: 't1',
        status: 'completed',
        download_url: 'x',
        download_expires_at: new Date(Date.now() + 1000),
      });
      await expect(service.getDownloadUrl('req-1', 't2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects when download URL has expired', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        tenant_id: 't1',
        status: 'completed',
        download_url: 'x',
        download_expires_at: new Date(Date.now() - 1000),
      });
      await expect(service.getDownloadUrl('req-1', 't1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when status is still queued', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'req-1',
        tenant_id: 't1',
        status: 'queued',
      });
      await expect(service.getDownloadUrl('req-1', 't1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound for unknown request', async () => {
      mockFindUnique.mockResolvedValue(null);
      await expect(service.getDownloadUrl('missing', 't1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('complete & fail', () => {
    it('complete updates status + download metadata', async () => {
      mockFindUnique.mockResolvedValue({ id: 'req-1' });
      const expires = new Date('2026-06-01');
      await service.complete('req-1', 'https://x', 1234, expires);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
            download_url: 'https://x',
            byte_size: 1234,
          }),
        }),
      );
    });

    it('fail records error message', async () => {
      await service.fail('req-1', 'S3 upload error');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            error_message: 'S3 upload error',
          }),
        }),
      );
    });
  });
});
