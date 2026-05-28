import { Test, TestingModule } from '@nestjs/testing';
import { ChurnPredictionService } from './churn-prediction.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('ChurnPredictionService', () => {
  let service: ChurnPredictionService;

  const mockPrisma = {
    crmContact: { findMany: jest.fn() },
    crmChurnScore: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    crmTicket: { count: jest.fn() },
    crmSentimentAnalysis: { findFirst: jest.fn() },
    booking: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChurnPredictionService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ChurnPredictionService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('compute', () => {
    it('returns low risk for active loyal guest', () => {
      const r = service.compute({
        daysSinceLastStay: 30,
        staysLast90d: 2,
        staysLast365d: 6,
        lifetimeValue: 50000,
        hasOpenTicket: false,
        lastSentimentScore: 0.6,
      });
      expect(r.riskBand).toBe('low');
      expect(r.riskScore).toBeLessThan(0.3);
    });

    it('returns critical risk for guest with no stay 365d+ and negative sentiment', () => {
      const r = service.compute({
        daysSinceLastStay: 400,
        staysLast90d: 0,
        staysLast365d: 0,
        lifetimeValue: 1000,
        hasOpenTicket: true,
        lastSentimentScore: -0.7,
      });
      expect(r.riskBand).toBe('critical');
      expect(r.reasons).toContain('no_stay_365d+');
      expect(r.reasons).toContain('open_service_ticket');
      expect(r.reasons).toContain('negative_sentiment');
    });

    it('returns medium risk for 100-day silence', () => {
      const r = service.compute({
        daysSinceLastStay: 100,
        staysLast90d: 0,
        staysLast365d: 3,
        lifetimeValue: 8000,
        hasOpenTicket: false,
        lastSentimentScore: null,
      });
      expect(r.riskBand).toBe('medium');
      expect(r.reasons).toContain('no_stay_90d+');
      expect(r.reasons).toContain('frequency_drop');
    });

    it('handles null lastStay (no stay ever)', () => {
      const r = service.compute({
        daysSinceLastStay: null,
        staysLast90d: 0,
        staysLast365d: 0,
        lifetimeValue: 0,
        hasOpenTicket: false,
        lastSentimentScore: null,
      });
      expect(r.reasons).toContain('no_stay_recorded');
    });

    it('clamps risk score to [0, 1]', () => {
      const r = service.compute({
        daysSinceLastStay: 999,
        staysLast90d: 0,
        staysLast365d: 0,
        lifetimeValue: 0,
        hasOpenTicket: true,
        lastSentimentScore: -1,
      });
      expect(r.riskScore).toBeLessThanOrEqual(1);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('listHighRisk', () => {
    it('queries only high + critical bands', async () => {
      mockPrisma.crmChurnScore.findMany.mockResolvedValue([]);
      await service.listHighRisk('t1');
      expect(mockPrisma.crmChurnScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 't1', riskBand: { in: ['high', 'critical'] } },
        }),
      );
    });
  });
});
