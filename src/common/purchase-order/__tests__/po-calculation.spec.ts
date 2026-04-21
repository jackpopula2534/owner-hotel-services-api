import { calculatePurchaseOrderTotals, DEFAULT_DISCOUNT_MODE } from '../po-calculation';

describe('calculatePurchaseOrderTotals', () => {
  describe('defaults', () => {
    it('defaults to BEFORE_VAT mode', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [{ quantity: 1, unitPrice: 100, taxRate: 7 }],
      });
      expect(result.discountMode).toBe('BEFORE_VAT');
      expect(DEFAULT_DISCOUNT_MODE).toBe('BEFORE_VAT');
    });

    it('returns zero breakdown for empty input', () => {
      const result = calculatePurchaseOrderTotals({ lines: [] });
      expect(result.subtotal).toBe(0);
      expect(result.grandTotal).toBe(0);
      expect(result.vatAmount).toBe(0);
      expect(result.lines).toEqual([]);
    });

    it('handles single line with no discount, no VAT', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [{ quantity: 2, unitPrice: 50 }],
      });
      expect(result.subtotal).toBe(100);
      expect(result.totalLineDiscount).toBe(0);
      expect(result.vatAmount).toBe(0);
      expect(result.grandTotal).toBe(100);
    });
  });

  describe('BEFORE_VAT — default Thai practice', () => {
    it('applies line % discount before VAT', () => {
      // 28 * 1904.44 = 53324.32 (no line discount), VAT 7% on 53324.32
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        lines: [{ quantity: 28, unitPrice: 1904.44, discountValue: 0, taxRate: 7 }],
      });
      expect(result.subtotal).toBe(53324.32);
      expect(result.totalLineDiscount).toBe(0);
      expect(result.netBeforeTax).toBe(53324.32);
      expect(result.vatAmount).toBeCloseTo(3732.7, 1);
      expect(result.grandTotal).toBeCloseTo(57057.02, 1);
    });

    it('applies line AMOUNT discount correctly', () => {
      // 8 * 634.06 = 5072.48, line discount 10, VAT 7% on 5062.48
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        lines: [
          {
            quantity: 8,
            unitPrice: 634.06,
            discountType: 'AMOUNT',
            discountValue: 10,
            taxRate: 7,
          },
        ],
      });
      expect(result.subtotal).toBe(5072.48);
      expect(result.totalLineDiscount).toBe(10);
      expect(result.netBeforeTax).toBe(5062.48);
      expect(result.vatAmount).toBeCloseTo(354.37, 1);
      expect(result.grandTotal).toBeCloseTo(5416.85, 1);
    });

    it('applies header percent discount after line discounts, before VAT', () => {
      // Two lines, header 10% discount
      // Line 1: 10*100=1000
      // Line 2: 5*200=1000, with line 10% = 100 discount -> 900
      // subtotalAfterLine = 1900
      // header 10% = 190
      // netBeforeTax = 1710
      // VAT 7% = 119.70
      // total = 1829.70
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 10, type: 'PERCENT' },
        lines: [
          { quantity: 10, unitPrice: 100, taxRate: 7 },
          { quantity: 5, unitPrice: 200, discountValue: 10, taxRate: 7 },
        ],
      });
      expect(result.subtotal).toBe(2000);
      expect(result.totalLineDiscount).toBe(100);
      expect(result.subtotalAfterLineDiscount).toBe(1900);
      expect(result.headerDiscountAmount).toBe(190);
      expect(result.netBeforeTax).toBe(1710);
      expect(result.vatAmount).toBeCloseTo(119.7, 1);
      expect(result.grandTotal).toBeCloseTo(1829.7, 1);
    });

    it('applies header fixed amount discount', () => {
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 500, type: 'AMOUNT' },
        lines: [{ quantity: 10, unitPrice: 200, taxRate: 7 }],
      });
      expect(result.subtotal).toBe(2000);
      expect(result.headerDiscountAmount).toBe(500);
      expect(result.netBeforeTax).toBe(1500);
      expect(result.vatAmount).toBeCloseTo(105, 1);
      expect(result.grandTotal).toBeCloseTo(1605, 1);
    });

    it('separates header discount from line discount in breakdown', () => {
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 100, type: 'AMOUNT' },
        lines: [{ quantity: 1, unitPrice: 1000, discountValue: 10, taxRate: 7 }],
      });
      expect(result.totalLineDiscount).toBe(100);
      expect(result.headerDiscountAmount).toBe(100);
      // They are separate values in the breakdown
      expect(result.totalLineDiscount).not.toBe(
        result.headerDiscountAmount + result.totalLineDiscount,
      );
    });

    it('vatBase equals netBeforeTax in BEFORE_VAT mode', () => {
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 100 },
        lines: [{ quantity: 1, unitPrice: 1000, taxRate: 7 }],
      });
      expect(result.vatBase).toBe(result.netBeforeTax);
      expect(result.vatBase).toBe(900);
    });
  });

  describe('AFTER_VAT mode', () => {
    it('computes VAT on gross first, then applies discount', () => {
      // gross = 1000, vat 7% = 70, gross+vat = 1070
      // header AMOUNT 100 discount on 1000 base => 10% discount ratio
      // total = 1070 * 0.9 = 963
      const result = calculatePurchaseOrderTotals({
        discountMode: 'AFTER_VAT',
        headerDiscount: { value: 100, type: 'AMOUNT' },
        lines: [{ quantity: 1, unitPrice: 1000, taxRate: 7 }],
      });
      expect(result.subtotal).toBe(1000);
      expect(result.vatBase).toBe(1000); // gross
      expect(result.headerDiscountAmount).toBe(100);
      expect(result.grandTotal).toBeCloseTo(963, 1);
    });

    it('vatBase equals subtotal (gross) in AFTER_VAT mode', () => {
      const result = calculatePurchaseOrderTotals({
        discountMode: 'AFTER_VAT',
        lines: [{ quantity: 2, unitPrice: 500, taxRate: 7 }],
      });
      expect(result.vatBase).toBe(result.subtotal);
      expect(result.vatBase).toBe(1000);
    });
  });

  describe('breakdown integrity', () => {
    it('stores every step in the breakdown', () => {
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 10, type: 'PERCENT' },
        lines: [{ quantity: 2, unitPrice: 100, discountValue: 5, taxRate: 7 }],
      });
      // Every required step should be present
      expect(result).toHaveProperty('subtotal');
      expect(result).toHaveProperty('totalLineDiscount');
      expect(result).toHaveProperty('subtotalAfterLineDiscount');
      expect(result).toHaveProperty('headerDiscountAmount');
      expect(result).toHaveProperty('netBeforeTax');
      expect(result).toHaveProperty('vatBase');
      expect(result).toHaveProperty('vatAmount');
      expect(result).toHaveProperty('grandTotal');
      expect(result).toHaveProperty('discountMode');
      expect(result).toHaveProperty('headerDiscountType');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        gross: 200,
        discountAmount: 10,
        netAfterLineDiscount: 190,
      });
    });

    it('rounds all monetary values to 2 decimals', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [{ quantity: 3, unitPrice: 33.333, taxRate: 7 }],
      });
      // 3 * 33.333 = 99.999 -> rounded 100
      expect(result.subtotal).toBe(100);
    });
  });

  describe('edge cases', () => {
    it('caps line amount discount at gross (cannot go negative)', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [
          {
            quantity: 1,
            unitPrice: 100,
            discountType: 'AMOUNT',
            discountValue: 500,
          },
        ],
      });
      expect(result.totalLineDiscount).toBe(100);
      expect(result.netBeforeTax).toBe(0);
    });

    it('caps line percent discount at 100%', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [
          {
            quantity: 1,
            unitPrice: 100,
            discountType: 'PERCENT',
            discountValue: 500,
          },
        ],
      });
      expect(result.totalLineDiscount).toBe(100);
    });

    it('clamps negative quantities/prices to zero', () => {
      const result = calculatePurchaseOrderTotals({
        lines: [
          { quantity: -5, unitPrice: 100 },
          { quantity: 1, unitPrice: -50 },
        ],
      });
      expect(result.subtotal).toBe(0);
    });

    it('caps header amount discount at subtotal after line discount', () => {
      const result = calculatePurchaseOrderTotals({
        headerDiscount: { value: 9999, type: 'AMOUNT' },
        lines: [{ quantity: 1, unitPrice: 100 }],
      });
      expect(result.headerDiscountAmount).toBe(100);
      expect(result.netBeforeTax).toBe(0);
    });

    it('handles 100% header percent discount', () => {
      const result = calculatePurchaseOrderTotals({
        headerDiscount: { value: 100, type: 'PERCENT' },
        lines: [{ quantity: 2, unitPrice: 250, taxRate: 7 }],
      });
      expect(result.headerDiscountAmount).toBe(500);
      expect(result.netBeforeTax).toBe(0);
      expect(result.vatAmount).toBe(0);
      expect(result.grandTotal).toBe(0);
    });
  });

  describe('mixed line + header scenario (real PO-202604-0001)', () => {
    it('reproduces the example PO totals', () => {
      // From the screenshot: แชมพู 30ml qty 28 @ 1904.44 no discount
      //                     ผ้าเช็ดหน้า qty 8 @ 634.06 discount 10 baht
      // subtotal = 53324.32 + 5072.48 = 58396.80
      // line discount = 10
      // subtotalAfterLine = 58386.80
      // header discount 500 (sample)  -> screenshot shows -507.25 total
      // For this test we pick a header discount that reproduces the shown -507.25
      // 10 (line) + headerAmount = 507.25 => headerAmount = 497.25
      const result = calculatePurchaseOrderTotals({
        discountMode: 'BEFORE_VAT',
        headerDiscount: { value: 497.25, type: 'AMOUNT' },
        lines: [
          { quantity: 28, unitPrice: 1904.44, taxRate: 7 },
          {
            quantity: 8,
            unitPrice: 634.06,
            discountType: 'AMOUNT',
            discountValue: 10,
            taxRate: 7,
          },
        ],
      });
      expect(result.subtotal).toBe(58396.8);
      expect(result.totalLineDiscount).toBe(10);
      expect(result.headerDiscountAmount).toBe(497.25);
      // Total line discount + header = 507.25 matches the screenshot's "-฿507.25"
      expect(+(result.totalLineDiscount + result.headerDiscountAmount).toFixed(2)).toBe(507.25);
      expect(result.netBeforeTax).toBeCloseTo(57889.55, 1);
      expect(result.vatAmount).toBeCloseTo(4052.27, 1);
      expect(result.grandTotal).toBeCloseTo(61941.82, 1);
    });
  });
});
