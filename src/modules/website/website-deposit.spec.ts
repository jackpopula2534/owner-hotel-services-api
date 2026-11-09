import { FULL_PAYMENT, allocateDue, depositDue, readDepositPolicy } from './website-deposit';

describe('website deposit policy', () => {
  it('reads Decimal strings and falls back to full payment', () => {
    expect(
      readDepositPolicy({ websiteDepositType: 'percentage', websiteDepositValue: '30.00' }),
    ).toEqual({
      type: 'percentage',
      value: 30,
    });
    expect(readDepositPolicy(null)).toEqual(FULL_PAYMENT);
    expect(readDepositPolicy({ websiteDepositType: 'fixed', websiteDepositValue: null })).toEqual(
      FULL_PAYMENT,
    );
    expect(readDepositPolicy({ websiteDepositType: 'bogus', websiteDepositValue: 10 })).toEqual(
      FULL_PAYMENT,
    );
  });

  it('takes a percentage of the grand total, rounded to satang', () => {
    expect(depositDue({ type: 'percentage', value: 30 }, 3177.9)).toBe(953.37);
  });

  it('takes a fixed amount per booking', () => {
    expect(depositDue({ type: 'fixed', value: 500 }, 3177.9)).toBe(500);
  });

  it('collects the full amount when the deposit would cover the whole stay', () => {
    expect(depositDue({ type: 'fixed', value: 5000 }, 3177.9)).toBeNull();
    expect(depositDue({ type: 'percentage', value: 100 }, 3177.9)).toBeNull();
    expect(depositDue(FULL_PAYMENT, 3177.9)).toBeNull();
  });

  describe('allocateDue (จองหลายห้อง)', () => {
    it('splits a group deposit by each room total and keeps the satang on the last room', () => {
      const shares = allocateDue(1000, [1765.5, 1765.5, 3531]);
      expect(shares).toEqual([250, 250, 500]);
      const odd = allocateDue(953.37, [1000, 1000, 1177.9]);
      expect(odd.reduce((a, b) => a + b, 0)).toBeCloseTo(953.37, 2);
      expect(odd).toEqual([300, 300, 353.37]);
    });

    it('charges every room in full when there is no deposit', () => {
      expect(allocateDue(null, [1765.5, 3531])).toEqual([1765.5, 3531]);
    });
  });
});
