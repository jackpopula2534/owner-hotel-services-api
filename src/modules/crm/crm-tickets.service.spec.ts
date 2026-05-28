import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmTicketsService } from './crm-tickets.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CrmTicketsService', () => {
  let service: CrmTicketsService;

  const mockPrisma = {
    crmTicket: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmTicketsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CrmTicketsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('throws without tenantId', async () => {
      await expect(service.create({ subject: 'x' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('computes SLA due based on priority when not provided', async () => {
      mockPrisma.crmTicket.create.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      const before = Date.now();
      const r = await service.create({ subject: 'Urgent', priority: 'urgent' }, 'tenant-1');
      const after = Date.now();
      expect(r.priority).toBe('urgent');
      const due = new Date(r.slaDueAt as Date).getTime();
      // Urgent = 30 minutes
      expect(due).toBeGreaterThanOrEqual(before + 29 * 60_000);
      expect(due).toBeLessThanOrEqual(after + 31 * 60_000);
    });

    it('uses provided slaDueAt when given', async () => {
      mockPrisma.crmTicket.create.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      const r = await service.create(
        { subject: 'x', slaDueAt: future, priority: 'low' },
        'tenant-1',
      );
      expect((r.slaDueAt as Date).toISOString()).toBe(future);
    });
  });

  describe('update', () => {
    it('throws NotFound when ticket missing', async () => {
      mockPrisma.crmTicket.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { status: 'closed' }, 'tenant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sets resolvedAt when status → resolved', async () => {
      mockPrisma.crmTicket.findFirst.mockResolvedValue({
        id: 't1',
        tenantId: 'tenant-1',
        status: 'open',
        resolvedAt: null,
        closedAt: null,
      });
      mockPrisma.crmTicket.update.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      await service.update('t1', { status: 'resolved' }, 'tenant-1');
      expect(mockPrisma.crmTicket.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
      });
    });

    it('sets closedAt + resolvedAt when status → closed without prior resolution', async () => {
      mockPrisma.crmTicket.findFirst.mockResolvedValue({
        id: 't1',
        tenantId: 'tenant-1',
        status: 'open',
        resolvedAt: null,
        closedAt: null,
      });
      mockPrisma.crmTicket.update.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      await service.update('t1', { status: 'closed' }, 'tenant-1');
      expect(mockPrisma.crmTicket.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: expect.objectContaining({
          status: 'closed',
          closedAt: expect.any(Date),
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('createFromEvent', () => {
    it('returns null and does not throw if create fails', async () => {
      mockPrisma.crmTicket.create.mockRejectedValue(new Error('db down'));
      const r = await service.createFromEvent('tenant-1', {
        subject: 'auto',
        channel: 'review',
      });
      expect(r).toBeNull();
    });

    it('forwards metadata as JSON string', async () => {
      mockPrisma.crmTicket.create.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      await service.createFromEvent('tenant-1', {
        subject: 'auto',
        channel: 'line',
        priority: 'high',
        metadata: { reviewId: 'r1', rating: 2 },
      });
      const created = mockPrisma.crmTicket.create.mock.calls[0][0].data;
      expect(JSON.parse(created.metadata)).toEqual({ reviewId: 'r1', rating: 2 });
    });
  });

  describe('recordCsat', () => {
    it('updates csatScore', async () => {
      mockPrisma.crmTicket.findFirst.mockResolvedValue({ id: 't1', tenantId: 'tenant-1' });
      mockPrisma.crmTicket.update.mockResolvedValue({ id: 't1', csatScore: 5 });
      const r = await service.recordCsat('t1', { score: 5 }, 'tenant-1');
      expect(r.csatScore).toBe(5);
    });
  });
});
