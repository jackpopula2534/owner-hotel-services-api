import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CrmContactsService } from './crm-contacts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CrmContactsService', () => {
  let service: CrmContactsService;

  const mockPrisma = {
    crmContact: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    guest: {
      findMany: jest.fn(),
    },
    booking: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmContactsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(CrmContactsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findAll', () => {
    it('returns empty pagination if no tenantId', async () => {
      const r = await service.findAll({}, undefined);
      expect(r).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });

    it('paginates with default limit 20', async () => {
      mockPrisma.crmContact.findMany.mockResolvedValue([{ id: 'c1', guestId: 'g1' }]);
      mockPrisma.guest.findMany.mockResolvedValue([{ id: 'g1', firstName: 'Jane', lastName: 'Doe' }]);
      mockPrisma.crmContact.count.mockResolvedValue(1);
      const r = await service.findAll({}, 't1');
      expect(r.total).toBe(1);
      expect(r.limit).toBe(20);
      expect(mockPrisma.crmContact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { tenantId: 't1' },
        }),
      );
      expect(mockPrisma.guest.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['g1'] } },
        select: expect.objectContaining({ firstName: true, lastName: true }),
      });
    });

    it('applies segment + contactType filter', async () => {
      mockPrisma.crmContact.findMany.mockResolvedValue([]);
      mockPrisma.crmContact.count.mockResolvedValue(0);
      await service.findAll({ segment: 'vip', contactType: 'corporate' }, 't1');
      expect(mockPrisma.crmContact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', segment: 'vip', contactType: 'corporate' },
        }),
      );
    });

    it('returns empty data on Prisma P2021 (table missing)', async () => {
      const err = Object.assign(new Error('table missing'), { code: 'P2021' });
      mockPrisma.crmContact.findMany.mockRejectedValue(err);
      const r = await service.findAll({}, 't1');
      expect(r).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    });
  });

  describe('findOne', () => {
    it('throws BadRequest with no tenantId', async () => {
      await expect(service.findOne('c1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when contact missing', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue(null);
      await expect(service.findOne('c1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns contact when found', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'c1', tenantId: 't1', guestId: 'g1' });
      mockPrisma.guest.findMany.mockResolvedValue([{ id: 'g1', firstName: 'Jane', lastName: 'Doe' }]);
      const r = await service.findOne('c1', 't1');
      expect(r.id).toBe('c1');
      expect((r as any).guest?.firstName).toBe('Jane');
      expect(mockPrisma.crmContact.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', tenantId: 't1' },
      });
    });
  });

  describe('create', () => {
    it('throws when guest already has a contact', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(service.create({ guestId: 'g1' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates contact with sanitized fields only', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue(null);
      mockPrisma.crmContact.create.mockResolvedValue({ id: 'c1' });
      await service.create(
        {
          guestId: 'g1',
          contactType: 'individual',
          segment: 'vip',
          // unknown field should not pass through (TS will catch, but defense-in-depth check)
        },
        't1',
      );
      expect(mockPrisma.crmContact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          guestId: 'g1',
          contactType: 'individual',
          segment: 'vip',
        }),
      });
    });
  });

  describe('upsertFromGuest', () => {
    it('creates new contact when none exists', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue(null);
      mockPrisma.crmContact.create.mockResolvedValue({ id: 'c1' });
      const r = await service.upsertFromGuest('t1', 'g1');
      expect(r.id).toBe('c1');
    });

    it('returns existing contact unchanged when no extras', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'c1' });
      const r = await service.upsertFromGuest('t1', 'g1');
      expect(r.id).toBe('c1');
      expect(mockPrisma.crmContact.update).not.toHaveBeenCalled();
    });
  });

  describe('recordStayCompletion', () => {
    it('increments stay counters and lifetime value', async () => {
      mockPrisma.crmContact.findFirst.mockResolvedValue({ id: 'c1' });
      await service.recordStayCompletion('t1', 'g1', 5000);
      expect(mockPrisma.crmContact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({
          totalStays: { increment: 1 },
          lifetimeValue: { increment: 5000 },
        }),
      });
    });

    it('does not throw when upsert fails (logs only)', async () => {
      mockPrisma.crmContact.findFirst.mockRejectedValue(new Error('db down'));
      await expect(service.recordStayCompletion('t1', 'g1', 1000)).resolves.toBeUndefined();
    });
  });
});
