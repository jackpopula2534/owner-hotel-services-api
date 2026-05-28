import { Test, TestingModule } from '@nestjs/testing';
import { SmartSegmentationService } from './smart-segmentation.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SmartSegmentationService', () => {
  let service: SmartSegmentationService;

  const mockPrisma = {
    crmContact: {
      findMany: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    crmChurnScore: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SmartSegmentationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SmartSegmentationService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolve', () => {
    it('returns "new" for first-time guest', () => {
      const r = service.resolve({
        totalStays: 1,
        lifetimeValue: 1000,
        daysSinceLastStay: 5,
        churnRiskBand: 'low',
      });
      expect(r).toBe('new');
    });

    it('returns "churn_risk" for high-band guest regardless of stays', () => {
      const r = service.resolve({
        totalStays: 10,
        lifetimeValue: 80000,
        daysSinceLastStay: 30,
        churnRiskBand: 'critical',
      });
      expect(r).toBe('churn_risk');
    });

    it('returns "dormant" for 180+ days inactive', () => {
      const r = service.resolve({
        totalStays: 4,
        lifetimeValue: 20000,
        daysSinceLastStay: 200,
        churnRiskBand: 'medium',
      });
      expect(r).toBe('dormant');
    });

    it('returns "vip" for high LTV + many stays', () => {
      const r = service.resolve({
        totalStays: 8,
        lifetimeValue: 80000,
        daysSinceLastStay: 30,
        churnRiskBand: 'low',
      });
      expect(r).toBe('vip');
    });

    it('returns "loyal" for ≥3 stays without VIP threshold', () => {
      const r = service.resolve({
        totalStays: 4,
        lifetimeValue: 12000,
        daysSinceLastStay: 30,
        churnRiskBand: 'low',
      });
      expect(r).toBe('loyal');
    });

    it('returns "regular" as fallback', () => {
      const r = service.resolve({
        totalStays: 2,
        lifetimeValue: 3000,
        daysSinceLastStay: 30,
        churnRiskBand: 'low',
      });
      expect(r).toBe('regular');
    });
  });

  describe('recomputeForTenant', () => {
    it('updates only contacts whose segment changes', async () => {
      mockPrisma.crmContact.findMany.mockResolvedValue([
        // Should change → regular → loyal
        {
          id: 'c1',
          guestId: 'g1',
          segment: 'regular',
          totalStays: 4,
          lifetimeValue: 12000,
          lastStayAt: new Date(),
        },
        // Already correct → no update
        {
          id: 'c2',
          guestId: 'g2',
          segment: 'new',
          totalStays: 1,
          lifetimeValue: 500,
          lastStayAt: new Date(),
        },
      ]);
      mockPrisma.crmChurnScore.findFirst.mockResolvedValue({ riskBand: 'low' });

      const updated = await service.recomputeForTenant('t1');
      expect(updated).toBe(1);
      expect(mockPrisma.crmContact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { segment: 'loyal' },
      });
    });
  });
});
