import { BadRequestException } from '@nestjs/common';
import { RetailPromoDiscountType } from '@prisma/client';
import {
  computePromoDiscount,
  jsonStringList,
  normalizeCode,
  PromoDiscountRule,
  resolveGiftGrant,
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
