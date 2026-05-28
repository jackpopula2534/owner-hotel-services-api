import { Test, TestingModule } from '@nestjs/testing';
import { SentimentService } from './sentiment.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SentimentService', () => {
  let service: SentimentService;

  const mockPrisma = {
    crmSentimentAnalysis: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SentimentService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(SentimentService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('analyze', () => {
    it('returns neutral for empty text', () => {
      const r = service.analyze('');
      expect(r.label).toBe('neutral');
      expect(r.score).toBe(0);
    });

    it('detects strong positive English', () => {
      const r = service.analyze('Absolutely amazing stay, the staff was wonderful and helpful');
      expect(r.label).toBe('positive');
      expect(r.score).toBeGreaterThan(0.5);
      expect(r.language).toBe('en');
    });

    it('detects strong negative English', () => {
      const r = service.analyze('Terrible experience, the room was dirty and the staff rude');
      expect(r.label).toBe('negative');
      expect(r.score).toBeLessThan(-0.5);
    });

    it('handles Thai positive review', () => {
      const r = service.analyze('โรงแรมดีมาก พนักงานน่ารัก ห้องสะอาด ประทับใจ');
      expect(r.label).toBe('positive');
      expect(r.language).toBe('th');
      expect(r.keywords.length).toBeGreaterThan(0);
    });

    it('handles Thai negative review', () => {
      const r = service.analyze('แย่มาก ห้องสกปรก บริการช้า ผิดหวัง');
      expect(r.label).toBe('negative');
      expect(r.score).toBeLessThan(-0.3);
    });

    it('flips polarity when negation present', () => {
      const positive = service.analyze('this was good');
      const negated = service.analyze('this was not good');
      expect(positive.score).toBeGreaterThan(0);
      expect(negated.score).toBeLessThan(positive.score);
    });

    it('returns neutral for non-emotional text', () => {
      const r = service.analyze('I stayed for 3 nights and ordered room service');
      expect(r.label).toBe('neutral');
    });

    it('scales confidence with number of matches', () => {
      const oneMatch = service.analyze('great');
      const manyMatches = service.analyze('great wonderful amazing excellent perfect comfortable');
      expect(manyMatches.confidence).toBeGreaterThan(oneMatch.confidence);
    });
  });

  describe('getTrend', () => {
    it('returns null sample for unknown tenant', async () => {
      const r = await service.getTrend('');
      expect(r).toBeNull();
    });

    it('aggregates label counts + avg score', async () => {
      mockPrisma.crmSentimentAnalysis.findMany.mockResolvedValue([
        { label: 'positive', score: 0.8 },
        { label: 'positive', score: 0.4 },
        { label: 'negative', score: -0.6 },
        { label: 'neutral', score: 0.1 },
      ]);
      const r = await service.getTrend('t1');
      expect(r?.total).toBe(4);
      expect(r?.positive).toBe(2);
      expect(r?.negative).toBe(1);
      expect(r?.neutral).toBe(1);
      expect(r?.avgScore).toBeCloseTo((0.8 + 0.4 - 0.6 + 0.1) / 4, 4);
    });
  });
});
