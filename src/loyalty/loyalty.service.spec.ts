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
      updateMany: jest.fn(),
    },
    loyaltyTransaction: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  /**
   * บัญชีแต้มในหน่วยความจำ — updateMany เคารพเงื่อนไข `points >= n` เหมือน DB จริง
   * (null = ยังไม่มีบัญชี ให้ create)
   */
  const useAccount = (initial: { points: number; lifetimePoints: number; tier?: string } | null) => {
    let row = initial ? { id: 'a1', tenantId: 't1', guestId: 'g1', tier: 'standard', ...initial } : null;
    mockTx.loyaltyPoint.findFirst.mockImplementation(async () => (row ? { ...row } : null));
    mockTx.loyaltyPoint.create.mockImplementation(async ({ data }) => {
      row = { id: 'a1', ...data };
      return { ...row };
    });
    mockTx.loyaltyPoint.updateMany.mockImplementation(async ({ where, data }) => {
      if (!row || (where.points?.gte != null && row.points < where.points.gte)) return { count: 0 };
      row.points += data.points.increment;
      row.lifetimePoints += data.lifetimePoints.increment;
      return { count: 1 };
    });
    mockTx.loyaltyPoint.update.mockImplementation(async ({ data }) => {
      Object.assign(row!, data);
      return { ...row };
    });
    mockTx.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' });
    return () => row;
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
      const account = useAccount(null);

      const r = await service.addPointsForStay('g1', 't1', 2500, { bookingId: 'b1' });
      expect(r?.pointsDelta).toBe(25);
      expect(r?.balance).toBe(25);
      expect(r?.lifetimePoints).toBe(25);
      expect(r?.tier).toBe('standard');
      expect(account()).toMatchObject({ points: 25, lifetimePoints: 25 });
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

    it('upgrades to silver tier after lifetime points cross 1000', async () => {
      useAccount({ points: 950, lifetimePoints: 950 });
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

    it('deducts points but keeps the tier (tier = lifetime points)', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({ id: 'a1', points: 1200 });
      const account = useAccount({ points: 1200, lifetimePoints: 1200, tier: 'silver' });

      const r = await service.redeem('t1', { guestId: 'g1', points: 500 });
      expect(r.pointsDelta).toBe(-500);
      expect(r.balance).toBe(700);
      expect(r.tier).toBe('silver');
      expect(account()).toMatchObject({ points: 700, lifetimePoints: 1200, tier: 'silver' });
    });

    it('loses a race for the last points → INSUFFICIENT_POINTS, balance untouched', async () => {
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({ id: 'a1', points: 600 });
      // อีกเครื่องแลกไปก่อนระหว่างเช็คกับหัก
      const account = useAccount({ points: 100, lifetimePoints: 600 });
      await expect(service.redeem('t1', { guestId: 'g1', points: 500 })).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_POINTS' },
      });
      expect(account()).toMatchObject({ points: 100, lifetimePoints: 600 });
      expect(mockTx.loyaltyTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('reverseStayAward', () => {
    it('claws back what is left but drops lifetime points by the full award', async () => {
      mockPrismaService.loyaltyTransaction.findMany.mockResolvedValue([{ type: 'earn', points: 300, reason: 'x' }]);
      mockPrismaService.loyaltyPoint.findFirst.mockResolvedValue({ points: 100 });
      const account = useAccount({ points: 100, lifetimePoints: 1100, tier: 'silver' });

      const r = await service.reverseStayAward('t1', 'g1', 'b1');
      expect(r?.pointsDelta).toBe(-100);
      expect(account()).toMatchObject({ points: 0, lifetimePoints: 800, tier: 'standard' });
    });
  });

  describe('retail sales', () => {
    it('earns 1 point per 100 THB of the net bill, tagged with the sale', async () => {
      const account = useAccount({ points: 0, lifetimePoints: 0 });
      const points = await service.earnForRetailSaleWithin(mockTx as never, {
        tenantId: 't1',
        guestId: 'g1',
        saleId: 's1',
        amount: 481.5,
      });
      expect(points).toBe(4);
      expect(account()).toMatchObject({ points: 4, lifetimePoints: 4 });
      expect(mockTx.loyaltyTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'earn', retailSaleId: 's1', reason: 'retail_sale' }),
      });
    });

    it('bill under 100 THB earns nothing', async () => {
      useAccount({ points: 0, lifetimePoints: 0 });
      const points = await service.earnForRetailSaleWithin(mockTx as never, {
        tenantId: 't1',
        guestId: 'g1',
        saleId: 's1',
        amount: 99.99,
      });
      expect(points).toBe(0);
      expect(mockTx.loyaltyPoint.updateMany).not.toHaveBeenCalled();
    });

    it('void claws the sale points back once', async () => {
      const account = useAccount({ points: 10, lifetimePoints: 10 });
      mockTx.loyaltyTransaction.findMany.mockResolvedValueOnce([{ type: 'earn', points: 4, reason: 'retail_sale' }]);
      expect(await service.reverseRetailSaleWithin(mockTx as never, { tenantId: 't1', guestId: 'g1', saleId: 's1' })).toBe(4);
      expect(account()).toMatchObject({ points: 6, lifetimePoints: 6 });

      mockTx.loyaltyTransaction.findMany.mockResolvedValueOnce([
        { type: 'earn', points: 4, reason: 'retail_sale' },
        { type: 'adjust', points: -4, reason: 'retail_sale_void' },
      ]);
      expect(await service.reverseRetailSaleWithin(mockTx as never, { tenantId: 't1', guestId: 'g1', saleId: 's1' })).toBe(0);
      expect(account()).toMatchObject({ points: 6 });
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
