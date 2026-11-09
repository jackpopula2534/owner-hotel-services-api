import { applyPromo, promoStayIneligibility } from './promo-discount';

const rule = { id: 'p1', code: 'SUMMER10' };

describe('applyPromo', () => {
  it('takes a percentage of the room subtotal, capped by maxDiscount', () => {
    expect(
      applyPromo({ ...rule, discountType: 'percentage', discountValue: 10 }, 3000).amount,
    ).toBe(300);
    expect(
      applyPromo({ ...rule, discountType: 'percentage', discountValue: 50, maxDiscount: 500 }, 3000)
        .amount,
    ).toBe(500);
  });

  it('never discounts more than the room subtotal', () => {
    expect(applyPromo({ ...rule, discountType: 'fixed', discountValue: 5000 }, 3000)).toMatchObject(
      {
        discountType: 'fixed',
        grossSubtotal: 3000,
        amount: 3000,
      },
    );
    expect(
      applyPromo({ ...rule, discountType: 'percentage', discountValue: 150 }, 1000).amount,
    ).toBe(1000);
  });
});

describe('promoStayIneligibility', () => {
  const r = { ...rule, discountType: 'fixed', discountValue: 100, minNights: 2, minAmount: 2500 };
  it('enforces minimum nights and room amount', () => {
    expect(promoStayIneligibility(r, { nights: 1, grossSubtotal: 9000 })).toMatch('2 คืน');
    expect(promoStayIneligibility(r, { nights: 2, grossSubtotal: 2000 })).toMatch('2,500');
    expect(promoStayIneligibility(r, { nights: 2, grossSubtotal: 3000 })).toBeNull();
  });
});
