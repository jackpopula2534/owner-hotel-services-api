import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CouponsService', () => {
  let service: CouponsService;
  let mockCoupons: any;
  let mockRedemptions: any;
  let mockTransaction: jest.Mock;

  beforeEach(async () => {
    mockCoupons = {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'c1', ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };
    mockRedemptions = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn(),
    };
    mockTransaction = jest.fn().mockImplementation(async (fn: any) => {
      const tx = {
        subscription_coupons: {
          update: jest.fn().mockResolvedValue({}),
        },
        subscription_coupon_redemptions: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        {
          provide: PrismaService,
          useValue: {
            subscription_coupons: mockCoupons,
            subscription_coupon_redemptions: mockRedemptions,
            $transaction: mockTransaction,
          },
        },
      ],
    }).compile();

    service = module.get(CouponsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects percent discount > 100', async () => {
      await expect(
        service.create({
          code: 'X',
          name: 'X',
          discountType: 'percent',
          discountValue: 150,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects negative fixed discount', async () => {
      await expect(
        service.create({
          code: 'X',
          name: 'X',
          discountType: 'fixed',
          discountValue: -100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('uppercases the code', async () => {
      await service.create({
        code: 'savings20',
        name: 'Savings 20',
        discountType: 'percent',
        discountValue: 20,
      });
      expect(mockCoupons.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'SAVINGS20' }),
        }),
      );
    });
  });

  describe('validate', () => {
    const baseCoupon = {
      id: 'c1',
      code: 'SAVE10',
      name: 'Save 10%',
      discount_type: 'percent',
      discount_value: 10,
      applies_to: 'any_plan',
      applicable_plan_ids: null,
      max_redemptions: null,
      redemptions_count: 0,
      max_redemptions_per_tenant: 1,
      valid_from: new Date('2026-01-01'),
      valid_until: new Date('2027-01-01'),
      is_active: 1,
    };

    it('returns valid + computed discount for percent type', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);

      const r = await service.validate({
        code: 'save10',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
      });

      expect(r.valid).toBe(true);
      expect(r.discountAmount).toBe(100);
      expect(r.finalAmount).toBe(900);
    });

    it('caps fixed discount at invoice amount', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        ...baseCoupon,
        discount_type: 'fixed',
        discount_value: 5000,
      });

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
      });

      expect(r.discountAmount).toBe(1000);
      expect(r.finalAmount).toBe(0);
    });

    it('rejects expired coupon', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-12-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/expired/i);
    });

    it('rejects when redemption limit reached', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        ...baseCoupon,
        max_redemptions: 100,
        redemptions_count: 100,
      });

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
      });
      expect(r.valid).toBe(false);
    });

    it('rejects when tenant already used the coupon', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);
      mockRedemptions.count.mockResolvedValueOnce(1);

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/already used/i);
    });

    it('rejects plan-specific coupon for wrong plan', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        ...baseCoupon,
        applies_to: 'specific_plans',
        applicable_plan_ids: ['plan-premium'],
      });

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
        planId: 'plan-basic',
      });
      expect(r.valid).toBe(false);
    });

    it('rejects first_invoice_only when not first invoice', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        ...baseCoupon,
        applies_to: 'first_invoice_only',
      });

      const r = await service.validate({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
        isFirstInvoice: false,
      });
      expect(r.valid).toBe(false);
    });
  });

  describe('redeem', () => {
    it('runs through transaction on valid coupon', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'X',
        is_active: 1,
        discount_type: 'percent',
        discount_value: 10,
        applies_to: 'any_plan',
        applicable_plan_ids: null,
        max_redemptions: null,
        redemptions_count: 0,
        max_redemptions_per_tenant: 1,
        valid_from: new Date('2026-01-01'),
        valid_until: new Date('2027-01-01'),
        name: 'X',
      });

      const r = await service.redeem({
        code: 'X',
        tenantId: 'tenant-1',
        invoiceAmount: 1000,
        invoiceId: 'inv-1',
      });

      expect(r.valid).toBe(true);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('throws when validation fails', async () => {
      mockCoupons.findUnique.mockResolvedValue(null);
      await expect(
        service.redeem({ code: 'NOPE', tenantId: 't1', invoiceAmount: 1000 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('preview (public)', () => {
    const baseCoupon = {
      id: 'c1',
      code: 'WELCOME10',
      name: 'Welcome',
      is_active: 1,
      discount_type: 'percent',
      discount_value: 10,
      applies_to: 'any_plan',
      applicable_plan_ids: null,
      max_redemptions: null,
      redemptions_count: 0,
      max_redemptions_per_tenant: 1,
      valid_from: new Date('2026-01-01'),
      valid_until: new Date('2027-01-01'),
    };

    it('returns valid + discount without requiring tenant context', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);

      const r = await service.preview({
        code: 'WELCOME10',
        invoiceAmount: 5000,
      });
      expect(r.valid).toBe(true);
      expect(r.discountAmount).toBe(500);
      expect(r.finalAmount).toBe(4500);
    });

    it('rejects expired coupon with Thai message', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-05-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);

      const r = await service.preview({
        code: 'WELCOME10',
        invoiceAmount: 5000,
      });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('คูปองหมดอายุแล้ว');
    });

    it('rejects plan-restricted coupon with wrong planId', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue({
        ...baseCoupon,
        applies_to: 'specific_plans',
        applicable_plan_ids: ['plan_pro'],
      });

      const r = await service.preview({
        code: 'WELCOME10',
        invoiceAmount: 5000,
        planId: 'plan_basic',
      });
      expect(r.valid).toBe(false);
    });

    it('does NOT enforce per-tenant cap (preview is tenant-agnostic)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findUnique.mockResolvedValue(baseCoupon);
      // count returns >0, but preview should ignore it
      mockRedemptions.count.mockResolvedValue(99);

      const r = await service.preview({
        code: 'WELCOME10',
        invoiceAmount: 5000,
      });
      expect(r.valid).toBe(true);
    });
  });

  describe('listPublic', () => {
    it('returns active non-expired coupons filtered by plan', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01'));
      mockCoupons.findMany.mockResolvedValue([
        {
          id: 'a',
          code: 'A',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 0,
          max_redemptions: null,
        },
        {
          id: 'b',
          code: 'B',
          is_active: 1,
          applies_to: 'specific_plans',
          applicable_plan_ids: ['plan_other'],
          redemptions_count: 0,
          max_redemptions: null,
        },
        {
          id: 'c',
          code: 'C',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 50,
          max_redemptions: 50, // exhausted
        },
      ]);

      const r = await service.listPublic({ planId: 'plan_pro' });
      const codes = r.map((c: any) => c.code);
      expect(codes).toContain('A');
      expect(codes).not.toContain('B'); // wrong plan
      expect(codes).not.toContain('C'); // exhausted
    });
  });

  describe('listFeatured', () => {
    it('only returns coupons inside their featured window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01T12:00:00Z'));
      mockCoupons.findMany.mockResolvedValue([
        {
          id: 'live',
          code: 'LIVE',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 0,
          max_redemptions: null,
          metadata: {
            featured: {
              isFeatured: true,
              featuredFrom: '2026-04-01T00:00:00Z',
              featuredUntil: '2026-06-01T00:00:00Z',
            },
          },
        },
        {
          id: 'too-early',
          code: 'EARLY',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 0,
          max_redemptions: null,
          metadata: {
            featured: {
              isFeatured: true,
              featuredFrom: '2027-01-01T00:00:00Z',
            },
          },
        },
        {
          id: 'expired',
          code: 'EXP',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 0,
          max_redemptions: null,
          metadata: {
            featured: {
              isFeatured: true,
              featuredUntil: '2025-01-01T00:00:00Z',
            },
          },
        },
        {
          id: 'not-featured',
          code: 'NOT',
          is_active: 1,
          applies_to: 'any_plan',
          applicable_plan_ids: null,
          redemptions_count: 0,
          max_redemptions: null,
          metadata: null,
        },
      ]);

      const r = await service.listFeatured({});
      const codes = r.map((c: any) => c.code);
      expect(codes).toEqual(['LIVE']);
    });

    it('respects plan-specific filter when planId is provided', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01T12:00:00Z'));
      mockCoupons.findMany.mockResolvedValue([
        {
          id: 'a',
          code: 'A',
          is_active: 1,
          applies_to: 'specific_plans',
          applicable_plan_ids: ['plan_pro'],
          redemptions_count: 0,
          max_redemptions: null,
          metadata: { featured: { isFeatured: true } },
        },
        {
          id: 'b',
          code: 'B',
          is_active: 1,
          applies_to: 'specific_plans',
          applicable_plan_ids: ['plan_basic'],
          redemptions_count: 0,
          max_redemptions: null,
          metadata: { featured: { isFeatured: true } },
        },
      ]);

      const r = await service.listFeatured({ planId: 'plan_pro' });
      expect(r.map((c: any) => c.code)).toEqual(['A']);
    });
  });

  describe('update', () => {
    it('throws NotFound when coupon does not exist', async () => {
      mockCoupons.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('writes only the provided fields and uppercases code', async () => {
      mockCoupons.findUnique.mockResolvedValue({
        id: 'c1',
        code: 'OLD',
        name: 'Old',
        metadata: null,
      });
      mockCoupons.update.mockResolvedValue({ id: 'c1' });

      await service.update('c1', {
        code: 'new10',
        name: 'New',
        discountType: 'percent',
        discountValue: 25,
      });

      const arg = mockCoupons.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'c1' });
      expect(arg.data.code).toBe('NEW10');
      expect(arg.data.name).toBe('New');
      expect(arg.data.discount_type).toBe('percent');
      expect(arg.data.discount_value).toBe(25);
      // unspecified fields should NOT be in the patch
      expect(arg.data.applies_to).toBeUndefined();
      expect(arg.data.valid_from).toBeUndefined();
    });

    it('replaces metadata.featured atomically', async () => {
      mockCoupons.findUnique.mockResolvedValue({
        id: 'c1',
        metadata: { other: 'keep', featured: { isFeatured: false } },
      });
      mockCoupons.update.mockResolvedValue({ id: 'c1' });

      await service.update('c1', {
        featured: {
          isFeatured: true,
          featuredFrom: '2026-05-01T00:00:00Z',
          bannerEmoji: '🎉',
        },
      });

      const arg = mockCoupons.update.mock.calls[0][0];
      expect(arg.data.metadata).toEqual({
        other: 'keep',
        featured: {
          isFeatured: true,
          featuredFrom: '2026-05-01T00:00:00Z',
          bannerEmoji: '🎉',
        },
      });
    });

    it('rejects out-of-range percent discount', async () => {
      mockCoupons.findUnique.mockResolvedValue({ id: 'c1', metadata: null });
      await expect(
        service.update('c1', { discountType: 'percent', discountValue: 150 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates Prisma P2002 into a friendly error', async () => {
      mockCoupons.findUnique.mockResolvedValue({ id: 'c1', metadata: null });
      mockCoupons.update.mockRejectedValue({ code: 'P2002' });
      await expect(service.update('c1', { code: 'DUPE' })).rejects.toThrow(BadRequestException);
    });

    it('clears applicable_plan_ids when scope leaves specific_plans', async () => {
      mockCoupons.findUnique.mockResolvedValue({
        id: 'c1',
        metadata: null,
        applies_to: 'specific_plans',
        applicable_plan_ids: ['plan_pro'],
      });
      mockCoupons.update.mockResolvedValue({ id: 'c1' });

      await service.update('c1', { appliesTo: 'any_plan' });

      const arg = mockCoupons.update.mock.calls[0][0];
      expect(arg.data.applies_to).toBe('any_plan');
      expect(arg.data.applicable_plan_ids).toBeNull();
    });
  });

  describe('admin operations', () => {
    it('deactivate throws NotFound when coupon missing', async () => {
      mockCoupons.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('missing')).rejects.toThrow(NotFoundException);
    });

    it('getStats aggregates redemptions', async () => {
      mockCoupons.findUnique.mockResolvedValue({ id: 'c1', code: 'X' });
      mockRedemptions.aggregate.mockResolvedValue({
        _sum: { discount_amount: 500 },
        _count: { id: 5 },
      });

      const r = await service.getStats('c1');
      expect(r.redemptionsCount).toBe(5);
      expect(r.totalDiscountGiven).toBe(500);
    });
  });
});
