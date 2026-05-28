import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('LeadService', () => {
  let service: LeadService;

  const mockTx = {
    crmLead: { update: jest.fn() },
    crmDeal: { create: jest.fn() },
  };

  const mockPrisma = {
    crmLead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LeadService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(LeadService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('throws without tenantId', async () => {
      await expect(
        service.create({ contactName: 'X', source: 'website' }, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets initial status to "new" and parses dates', async () => {
      mockPrisma.crmLead.create.mockImplementation(async ({ data }) => ({ id: 'l1', ...data }));
      const r = await service.create(
        {
          contactName: 'Acme Co',
          source: 'website',
          expectedCheckIn: '2026-12-01',
        },
        't1',
      );
      expect(r.status).toBe('new');
      expect(r.tenantId).toBe('t1');
      const createCall = mockPrisma.crmLead.create.mock.calls[0][0];
      expect(createCall.data.expectedCheckIn).toBeInstanceOf(Date);
    });
  });

  describe('qualify', () => {
    it('rejects qualify on converted lead', async () => {
      mockPrisma.crmLead.findFirst.mockResolvedValue({
        id: 'l1',
        tenantId: 't1',
        status: 'converted',
      });
      await expect(
        service.qualify('l1', { dealName: 'D', amount: 1000 }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects qualify on lost lead', async () => {
      mockPrisma.crmLead.findFirst.mockResolvedValue({
        id: 'l1',
        tenantId: 't1',
        status: 'lost',
      });
      await expect(
        service.qualify('l1', { dealName: 'D', amount: 1000 }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates deal + marks lead converted (transactional)', async () => {
      mockPrisma.crmLead.findFirst.mockResolvedValue({
        id: 'l1',
        tenantId: 't1',
        status: 'qualified',
        contactId: null,
        companyName: 'Acme',
        ownerUserId: 'u1',
        partySize: 50,
        expectedCheckIn: null,
        expectedCheckOut: null,
        notes: null,
      });
      mockTx.crmDeal.create.mockResolvedValue({
        id: 'd1',
        name: 'D',
        amount: 1000,
        stage: 'discovery',
      });
      mockTx.crmLead.update.mockResolvedValue({ id: 'l1', status: 'converted' });

      const r = await service.qualify('l1', { dealName: 'D', amount: 1000, probability: 30 }, 't1');
      expect(r.deal.id).toBe('d1');
      expect(r.lead.status).toBe('converted');
      expect(mockTx.crmDeal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          leadId: 'l1',
          name: 'D',
          amount: 1000,
          probability: 30,
          stage: 'discovery',
        }),
      });
      expect(mockTx.crmLead.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: { status: 'converted', convertedDealId: 'd1' },
      });
    });
  });

  describe('remove', () => {
    it('refuses to delete converted lead', async () => {
      mockPrisma.crmLead.findFirst.mockResolvedValue({
        id: 'l1',
        tenantId: 't1',
        status: 'converted',
      });
      await expect(service.remove('l1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when missing', async () => {
      mockPrisma.crmLead.findFirst.mockResolvedValue(null);
      await expect(service.remove('l1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
