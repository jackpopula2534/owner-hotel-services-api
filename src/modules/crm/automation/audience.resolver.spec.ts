import { Test, TestingModule } from '@nestjs/testing';
import { AudienceResolver } from './audience.resolver';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AudienceResolver', () => {
  let resolver: AudienceResolver;

  const mockPrisma = {
    crmContact: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    guest: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AudienceResolver, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    resolver = module.get(AudienceResolver);
  });

  afterEach(() => jest.clearAllMocks());

  describe('parseQuery', () => {
    it('returns empty object for null', () => {
      expect(AudienceResolver.parseQuery(null)).toEqual({});
    });

    it('returns empty object for invalid JSON', () => {
      expect(AudienceResolver.parseQuery('{not json')).toEqual({});
    });

    it('parses valid JSON', () => {
      expect(AudienceResolver.parseQuery('{"segments":["vip"]}')).toEqual({
        segments: ['vip'],
      });
    });
  });

  describe('resolve', () => {
    it('returns empty if no tenantId', async () => {
      const r = await resolver.resolve('', { segments: ['vip'] });
      expect(r).toEqual([]);
    });

    it('applies segment + minLifetimeValue filter', async () => {
      mockPrisma.crmContact.findMany.mockResolvedValue([]);
      mockPrisma.guest.findMany.mockResolvedValue([]);
      await resolver.resolve('t1', { segments: ['vip'], minLifetimeValue: 5000 });
      expect(mockPrisma.crmContact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 't1',
            segment: { in: ['vip'] },
            lifetimeValue: { gte: 5000 },
          },
        }),
      );
    });

    it('filters out guests without marketing consent (PDPA)', async () => {
      mockPrisma.crmContact.findMany.mockResolvedValue([
        { id: 'c1', guestId: 'g1', preferredChannel: 'email' },
        { id: 'c2', guestId: 'g2', preferredChannel: 'email' },
      ]);
      mockPrisma.guest.findMany.mockResolvedValue([
        { id: 'g1', email: 'a@b.c', consentGiven: true },
        { id: 'g2', email: 'd@e.f', consentGiven: false }, // no consent
      ]);
      const r = await resolver.resolve('t1', { segments: ['vip'] });
      expect(r).toEqual([
        { contactId: 'c1', guestId: 'g1', email: 'a@b.c', preferredChannel: 'email' },
      ]);
    });

    it('returns [] on Prisma error (table missing)', async () => {
      mockPrisma.crmContact.findMany.mockRejectedValue(
        Object.assign(new Error('table missing'), { code: 'P2021' }),
      );
      const r = await resolver.resolve('t1', { segments: ['vip'] });
      expect(r).toEqual([]);
    });
  });

  describe('estimateSize', () => {
    it('returns count from Prisma', async () => {
      mockPrisma.crmContact.count.mockResolvedValue(42);
      const r = await resolver.estimateSize('t1', { segments: ['vip'] });
      expect(r).toBe(42);
    });

    it('returns 0 on error', async () => {
      mockPrisma.crmContact.count.mockRejectedValue(new Error('db down'));
      const r = await resolver.estimateSize('t1', {});
      expect(r).toBe(0);
    });
  });
});
