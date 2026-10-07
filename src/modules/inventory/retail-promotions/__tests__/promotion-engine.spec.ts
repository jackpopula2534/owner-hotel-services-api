import { BadRequestException } from '@nestjs/common';
import { RetailPromoDiscountType } from '@prisma/client';
import {
  audienceError,
  computePromoDiscount,
  isRestrictedPromotion,
  jsonStringList,
  normalizeCode,
  PromoDiscountRule,
  resolveGiftGrant,
  selectStackedPromotions,
} from '../promotion-engine';

const rule = (over: Partial<PromoDiscountRule> = {}): PromoDiscountRule => ({
  discountType: RetailPromoDiscountType.PERCENT,
  discountValue: 10,
  maxDiscount: null,
  minSpend: 0,
  eligibleItemIds: [],
  ...over,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { code?: string }).code;
  }
  return undefined;
};

describe('promotion-engine', () => {
  const cart = [
    { itemId: 'water', quantity: 2, unitPrice: 20 }, // 40
    { itemId: 'snack', quantity: 1, unitPrice: 100, lineDiscount: 10 }, // 90
  ];

  describe('computePromoDiscount', () => {
    it('takes a percentage of the net cart (after line discounts)', () => {
      expect(computePromoDiscount(rule(), cart)).toEqual({
        netSubtotal: 130,
        eligibleSubtotal: 130,
        discount: 13,
      });
    });

    it('caps a percentage at maxDiscount', () => {
      expect(computePromoDiscount(rule({ discountValue: 50, maxDiscount: 20 }), cart).discount).toBe(20);
    });

    it('never discounts more than the eligible items are worth', () => {
      const r = rule({ discountType: RetailPromoDiscountType.FIXED, discountValue: 100, eligibleItemIds: ['water'] });
      expect(computePromoDiscount(r, cart).discount).toBe(40);
    });

    it('limits the discount base to eligible items', () => {
      expect(computePromoDiscount(rule({ eligibleItemIds: ['snack'] }), cart).discount).toBe(9);
    });

    it('rejects a cart below min spend with the shortfall', () => {
      expect(codeOf(() => computePromoDiscount(rule({ minSpend: 500 }), cart))).toBe('PROMO_MIN_SPEND');
    });

    it('rejects a discount promo when no eligible item is in the cart', () => {
      expect(codeOf(() => computePromoDiscount(rule({ eligibleItemIds: ['other'] }), cart))).toBe(
        'PROMO_NO_ELIGIBLE_ITEM',
      );
    });

    it('gives zero discount for a gift-only promo without demanding eligible items', () => {
      const r = rule({ discountType: RetailPromoDiscountType.NONE, eligibleItemIds: ['other'] });
      expect(computePromoDiscount(r, cart).discount).toBe(0);
    });
  });

  describe('resolveGiftGrant', () => {
    const towel = { itemId: 'towel', quantity: 1, availableQty: 5 };
    const bag = { itemId: 'bag', quantity: 2, availableQty: 1 };

    it('grants every gift that is in stock', () => {
      expect(resolveGiftGrant([towel], 0, false)).toEqual({ granted: [towel], skipped: [] });
    });

    it('refuses a short gift unless the cashier accepted discount-only', () => {
      expect(codeOf(() => resolveGiftGrant([towel, bag], 50, false))).toBe('PROMO_GIFT_SHORTAGE');
      expect(resolveGiftGrant([towel, bag], 50, true)).toEqual({ granted: [towel], skipped: [bag] });
    });

    it('rejects a promo that would give nothing at all', () => {
      expect(codeOf(() => resolveGiftGrant([bag], 0, true))).toBe('PROMO_NO_BENEFIT');
    });

    it('lets a discount-only acceptance through when every gift is out', () => {
      expect(resolveGiftGrant([bag], 30, true)).toEqual({ granted: [], skipped: [bag] });
    });
  });

  it('normalizes codes and JSON lists', () => {
    expect(normalizeCode('  summer10 ')).toBe('SUMMER10');
    expect(jsonStringList(['a', 1, '', 'b'])).toEqual(['a', 'b']);
    expect(jsonStringList(null)).toEqual([]);
  });
});

describe('audience rules', () => {
  const open = { eligibleTiers: [], eligibleSegments: [], perMemberLimit: null };
  const codeOf = (e: BadRequestException | null) => (e?.getResponse() as { code?: string } | undefined)?.code;

  it('a promotion without tier/segment/per-member limit is open to non-members', () => {
    expect(isRestrictedPromotion(open)).toBe(false);
    expect(isRestrictedPromotion({ ...open, eligibleTiers: ['gold'] })).toBe(true);
    expect(isRestrictedPromotion({ ...open, eligibleSegments: ['vip'] })).toBe(true);
    expect(isRestrictedPromotion({ ...open, perMemberLimit: 1 })).toBe(true);
  });

  it('checks tier, then segment, then the per-member limit', () => {
    const member = { tier: 'silver', segment: 'vip' };
    expect(audienceError(open, member, 99)).toBeNull();
    expect(codeOf(audienceError({ ...open, eligibleTiers: ['gold'] }, member, 0))).toBe('PROMO_TIER_NOT_ELIGIBLE');
    expect(codeOf(audienceError({ ...open, eligibleSegments: ['new'] }, member, 0))).toBe('PROMO_SEGMENT_NOT_ELIGIBLE');
    expect(codeOf(audienceError({ ...open, eligibleSegments: ['vip'] }, { tier: 'silver', segment: null }, 0))).toBe(
      'PROMO_SEGMENT_NOT_ELIGIBLE',
    );
    expect(codeOf(audienceError({ ...open, perMemberLimit: 2 }, member, 2))).toBe('PROMO_MEMBER_LIMIT');
    expect(audienceError({ ...open, perMemberLimit: 2 }, member, 1)).toBeNull();
  });
});

describe('selectStackedPromotions', () => {
  const a = { id: 'a', stackable: true };
  const b = { id: 'b', stackable: true };
  const solo = { id: 'solo', stackable: false };
  const ids = (r: ReturnType<typeof selectStackedPromotions>) => ({
    selected: r.selected.map((p) => p.id),
    blocked: r.blocked.map((x) => `${x.promotion.id}:${x.reason}`),
  });

  it('a stackable code combines with every stackable auto promotion', () => {
    expect(ids(selectStackedPromotions({ id: 'code', stackable: true }, [a, solo, b]))).toEqual({
      selected: ['a', 'b'],
      blocked: ['solo:NOT_STACKABLE'],
    });
  });

  it('a non-stackable code wins alone', () => {
    expect(ids(selectStackedPromotions({ id: 'code', stackable: false }, [a, b]))).toEqual({
      selected: [],
      blocked: ['a:CODE_NOT_STACKABLE', 'b:CODE_NOT_STACKABLE'],
    });
  });

  it('without a code, stackable autos win; a lone non-stackable auto still applies', () => {
    expect(ids(selectStackedPromotions(null, [solo, a]))).toEqual({ selected: ['a'], blocked: ['solo:NOT_STACKABLE'] });
    expect(ids(selectStackedPromotions(null, [solo, { id: 'solo2', stackable: false }]))).toEqual({
      selected: ['solo'],
      blocked: ['solo2:NOT_STACKABLE'],
    });
    expect(ids(selectStackedPromotions(null, []))).toEqual({ selected: [], blocked: [] });
  });
});
