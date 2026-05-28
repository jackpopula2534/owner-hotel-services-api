import { Test, TestingModule } from '@nestjs/testing';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('LoyaltyService', () => {
  let service: LoyaltyService;
  let prisma: PrismaService;

  const mockTx = {
    loyaltyPoint: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    loyaltyTransaction: {
      create: jest.fn(),
    },
  };

  const mockPrismaService = {
    loyaltyPoint: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    loyaltyTransaction: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    referral: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LoyaltyService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<LoyaltyService>(LoyaltyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPoints', () => {
    it('returns default zero balance for missing tenantId', async () => {
      const result = await service.getPoints('');
      expect(result.points).toBe(0);
      expect(result.tier).toBe('standard');
    });

    it('returns existing tenant-level loyalty record', async () => {
      const existing = { id: 'l1', tenantId: 't1', guestId: null, points: 500, tier: 'silver' };
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue(existing);
      const result = await service.getPoints('t1');
      expect(result).toEqual(existing);
      expect(prisma.loyaltyPoint.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 't1', guestId: null },
      });
    });

    it('creates default record when none exists', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue(null);
      mockPrismaService.loyaltyPoint.create.mockResolvedValue({
        id: 'new',
        tenantId: 't1',
        points: 0,
        tier: 'standard',
      });
      const result = await service.getPoints('t1');
      expect(result.points).toBe(0);
      expect(prisma.loyaltyPoint.create).toHaveBeenCalled();
    });
  });

  describe('getGuestBalance', () => {
    it('throws BadRequest when guestId missing', async () => {
      await expect(service.getGuestBalance('t1', '')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns guest account when found', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        guestId: 'g1',
        points: 1500,
        tier: 'silver',
      });
      const result = await service.getGuestBalance('t1', 'g1');
      expect(result.points).toBe(1500);
    });
  });

  describe('addPointsForStay', () => {
    it('skips when guestId missing', async () => {
      const r = await service.addPointsForStay('', 't1', 5000);
      expect(r).toBeNull();
    });

    it('skips when booking amount too small', async () => {
      const r = await service.addPointsForStay('g1', 't1', 50);
      expect(r).toBeNull();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('awards 25 points for 2500 THB booking and updates tier', async () => {
      mockTx.loyaltyPoint.findFirst.mockResolvedValue(null);
      mockTx.loyaltyPoint.create.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        guestId: 'g1',
        points: 0,
        tier: 'standard',
      });
      mockTx.loyaltyPoint.update.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        guestId: 'g1',
        points: 25,
        tier: 'standard',
      });
      mockTx.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' });

      const r = await service.addPointsForStay('g1', 't1', 2500, { bookingId: 'b1' });
      expect(r?.pointsDelta).toBe(25);
      expect(r?.balance).toBe(25);
      expect(r?.tier).toBe('standard');
      expect(mockTx.loyaltyTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'earn',
            points: 25,
            bookingId: 'b1',
            tenantId: 't1',
            guestId: 'g1',
          }),
        }),
      );
    });

    it('upgrades to silver tier after crossing 1000 points', async () => {
      mockTx.loyaltyPoint.findFirst.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        guestId: 'g1',
        points: 950,
        tier: 'standard',
      });
      mockTx.loyaltyPoint.update.mockResolvedValue({
        id: 'a1',
        points: 1000,
        tier: 'silver',
      });
      mockTx.loyaltyTransaction.create.mockResolvedValue({ id: 'tx2' });

      const r = await service.addPointsForStay('g1', 't1', 5000);
      expect(r?.tier).toBe('silver');
      expect(r?.balance).toBe(1000);
    });
  });

  describe('redeem', () => {
    it('throws when insufficient balance', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({ points: 100 });
      await expect(service.redeem('t1', { guestId: 'g1', points: 500 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('deducts points when sufficient balance', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({
        id: 'a1',
        points: 800,
        tier: 'standard',
      });
      mockTx.loyaltyPoint.findFirst.mockResolvedValue({
        id: 'a1',
        tenantId: 't1',
        guestId: 'g1',
        points: 800,
        tier: 'standard',
      });
      mockTx.loyaltyPoint.update.mockResolvedValue({
        id: 'a1',
        points: 300,
        tier: 'standard',
      });
      mockTx.loyaltyTransaction.create.mockResolvedValue({ id: 'tx3' });

      const r = await service.redeem('t1', { guestId: 'g1', points: 500 });
      expect(r.pointsDelta).toBe(-500);
      expect(r.balance).toBe(300);
    });
  });

  describe('inviteReferral', () => {
    it('creates a referral invitation', async () => {
      mockPrismaService.referral.create.mockResolvedValue({ id: 'r1', email: 'a@b.c' });
      const r = await service.inviteReferral('u1', 't1', { email: 'a@b.c' });
      expect(r).toEqual({ id: 'r1', email: 'a@b.c' });
      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          referrerId: 'u1',
          tenantId: 't1',
          email: 'a@b.c',
          rewardPoints: 100,
        }),
      });
    });
  });
});
