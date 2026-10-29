import { detectQuoteVariance } from '../quote-variance';

const quote = {
  headerDiscount: '381.31',
  headerDiscountType: 'AMOUNT',
  items: [
    { itemId: 'n', quantity: 14, unitPrice: '1105.36', discount: '7', taxRate: '7' },
    { itemId: 's', quantity: 45, unitPrice: '1431.84', discount: '10', taxRate: '7' },
  ],
};
const po = {
  headerDiscount: 381.31,
  headerDiscountType: 'AMOUNT' as const,
  items: [
    { itemId: 'n', quantity: 14, unitPrice: 1105.36, discount: 7 },
    { itemId: 's', quantity: 45, unitPrice: 1431.84, discount: 10 },
  ],
};

describe('detectQuoteVariance', () => {
  it('finds nothing when the PO reproduces the quote', () => {
    expect(detectQuoteVariance(quote, po)).toEqual([]);
  });

  it('flags quantity, price and header changes', () => {
    const v = detectQuoteVariance(quote, {
      ...po,
      headerDiscount: 0,
      items: [
        { itemId: 'n', quantity: 14, unitPrice: 1110, discount: 7 },
        { itemId: 's', quantity: 40, unitPrice: 1431.84, discount: 10 },
      ],
    });
    expect(v.map((e) => e.field).sort()).toEqual(['headerDiscount', 'quantity', 'unitPrice']);
  });

  it('flags removed and added items', () => {
    const v = detectQuoteVariance(quote, {
      ...po,
      items: [po.items[0], { itemId: 'x', quantity: 1, unitPrice: 5 }],
    });
    expect(v).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'item', itemId: 's', po: null }),
        expect.objectContaining({ field: 'item', itemId: 'x', quote: null }),
      ]),
    );
  });

  it('accepts the ex-VAT conversion of a VAT-inclusive quote', () => {
    const incl = {
      pricesIncludeVat: true,
      headerDiscount: 107,
      headerDiscountType: 'AMOUNT',
      items: [
        {
          itemId: 'n',
          quantity: 2,
          unitPrice: 1070,
          discount: 10.7,
          discountType: 'AMOUNT',
          taxRate: 7,
        },
      ],
    };
    expect(
      detectQuoteVariance(incl, {
        headerDiscount: 100,
        headerDiscountType: 'AMOUNT',
        items: [
          { itemId: 'n', quantity: 2, unitPrice: 1000, discount: 10, discountType: 'AMOUNT' },
        ],
      }),
    ).toEqual([]);
  });
});
