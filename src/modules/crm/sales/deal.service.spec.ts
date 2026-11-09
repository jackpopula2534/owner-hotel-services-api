import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DealService } from './deal.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('DealService', () => {
  let service: DealService;

  const mockPrisma = {
    crmDeal: {
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
      providers: [DealService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(DealService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('sets initial stage to discovery + default probability 20', async () => {
      mockPrisma.crmDeal.create.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
      const r = await service.create({ name: 'X', amount: 5000 }, 't1');
      expect(r.stage).toBe('discovery');
      expect(r.probability).toBe(20);
    });
  });

  describe('moveStage', () => {
    it('forward-only — rejects discovery → discovery', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'discovery',
      });
      await expect(service.moveStage('d1', { stage: 'discovery' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('forward-only — rejects negotiation → quoted (backward)', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'negotiation',
      });
      await expect(service.moveStage('d1', { stage: 'quoted' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows discovery → quoted, sets probability to 50', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'discovery',
      });
      mockPrisma.crmDeal.update.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
      const r = await service.moveStage('d1', { stage: 'quoted' }, 't1');
      expect(r.stage).toBe('quoted');
      expect(r.probability).toBe(50);
    });

    it('moves to won — sets closedAt + probability 100', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'negotiation',
      });
      mockPrisma.crmDeal.update.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
      const r = await service.moveStage('d1', { stage: 'won' }, 't1');
      expect(r.stage).toBe('won');
      expect(r.probability).toBe(100);
      expect(r.closedAt).toBeInstanceOf(Date);
    });

    it('requires lostReason when moving to lost', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'discovery',
      });
      await expect(service.moveStage('d1', { stage: 'lost' }, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('moves to lost — stores reason + closedAt', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'quoted',
      });
      mockPrisma.crmDeal.update.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
      const r = await service.moveStage('d1', { stage: 'lost', lostReason: 'budget cut' }, 't1');
      expect(r.stage).toBe('lost');
      expect(r.lostReason).toBe('budget cut');
      expect(r.closedAt).toBeInstanceOf(Date);
    });

    it('rejects move on terminal won deal', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'won',
      });
      await expect(
        service.moveStage('d1', { stage: 'lost', lostReason: 'oops' }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('attachBookings', () => {
    it('rejects attach on non-won deal', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'quoted',
      });
      await expect(service.attachBookings('d1', ['b1'], 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('dedups merged booking ids', async () => {
      mockPrisma.crmDeal.findFirst.mockResolvedValue({
        id: 'd1',
        tenantId: 't1',
        stage: 'won',
        bookingIds: JSON.stringify(['b1', 'b2']),
      });
      mockPrisma.crmDeal.update.mockImplementation(async ({ data }) => ({ id: 'd1', ...data }));
      const r = await service.attachBookings('d1', ['b2', 'b3'], 't1');
      expect(JSON.parse(r.bookingIds as string)).toEqual(['b1', 'b2', 'b3']);
    });
  });

  describe('forecast', () => {
    it('computes weighted pipeline value + win rate', async () => {
      mockPrisma.crmDeal.findMany
        // pipeline query
        .mockResolvedValueOnce([
          { stage: 'discovery', amount: 1000, probability: 20 },
          { stage: 'quoted', amount: 5000, probability: 50 },
          { stage: 'negotiation', amount: 2000, probability: 75 },
        ])
        // won query
        .mockResolvedValueOnce([{ amount: 10000 }, { amount: 5000 }]);
      mockPrisma.crmDeal.count.mockResolvedValue(5); // lost

      const r = await service.forecast('t1');
      expect(r?.pipeline.discovery.amount).toBe(1000);
      expect(r?.pipeline.discovery.weighted).toBe(200); // 1000 * 0.2
      expect(r?.pipeline.quoted.weighted).toBe(2500);
      expect(r?.pipelineTotal).toBe(8000);
      expect(r?.weightedTotal).toBe(200 + 2500 + 1500);
      expect(r?.won.amount).toBe(15000);
      // 2 won / (2 won + 5 lost) = 2/7
      expect(r?.winRate).toBeCloseTo(2 / 7, 4);
    });
  });
});
