import {
  addonChargesForRenewal,
  bangkokToday,
  cancelEffectiveDate,
  computeBillLaterWindow,
  vatOnTop,
  wholeMonthsBetween,
} from './addon-billing';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

describe('computeBillLaterWindow', () => {
  it('first time: clicked Oct 19, bills on the 1st → free until Dec 1 (Nov 1 bill is plan only)', () => {
    const w = computeBillLaterWindow({
      today: d('2026-10-19'),
      nextBoundary: d('2026-11-01'),
      usedTrial: false,
      usedFreeWindow: false,
    });
    expect(day(w.billingStartsOn)).toBe('2026-12-01');
    expect(day(w.firstChargeDate)).toBe('2026-12-01');
    expect(day(w.committedUntil)).toBe('2027-01-01');
    expect(w.arrears).toBe(false);
  });

  it('first time: boundary already ≥ 1 month away is used as-is', () => {
    const w = computeBillLaterWindow({
      today: d('2026-10-01'),
      nextBoundary: d('2026-11-01'),
      usedTrial: false,
      usedFreeWindow: false,
    });
    expect(day(w.billingStartsOn)).toBe('2026-11-01');
  });

  it('trial used: free only until the next boundary', () => {
    const w = computeBillLaterWindow({
      today: d('2026-10-19'),
      nextBoundary: d('2026-11-01'),
      usedTrial: true,
      usedFreeWindow: false,
    });
    expect(day(w.billingStartsOn)).toBe('2026-11-01');
    expect(w.arrears).toBe(false);
  });

  it('re-activation: billed from the current cycle start, on the next renewal', () => {
    const w = computeBillLaterWindow({
      today: d('2026-10-19'),
      nextBoundary: d('2026-11-01'),
      usedTrial: false,
      usedFreeWindow: true,
    });
    expect(day(w.billingStartsOn)).toBe('2026-10-01');
    expect(day(w.firstChargeDate)).toBe('2026-11-01');
    expect(w.arrears).toBe(true);
  });

  it('end_date already passed (renewal cron late) rolls to the first future boundary', () => {
    const w = computeBillLaterWindow({
      today: d('2026-10-19'),
      nextBoundary: d('2026-10-01'),
      usedTrial: true,
      usedFreeWindow: false,
    });
    expect(day(w.billingStartsOn)).toBe('2026-11-01');
  });

  it('clamps month-end anchors against the anchor (Jan 31 → Feb 28 → Mar 31)', () => {
    const w = computeBillLaterWindow({
      today: d('2027-02-10'),
      nextBoundary: d('2027-01-31'),
      usedTrial: false,
      usedFreeWindow: false,
    });
    expect(day(w.billingStartsOn)).toBe('2027-03-31');
  });
});

describe('addonChargesForRenewal', () => {
  const billLater = (over: Record<string, unknown> = {}) => ({
    id: 'sf-1',
    price: 200,
    billingMode: 'bill_later',
    billingStartsOn: d('2026-12-01'),
    billedThrough: null,
    cancelAt: null,
    ...over,
  });

  it('skips a bill-later add-on still in its free window', () => {
    expect(addonChargesForRenewal([billLater()], d('2026-11-01'), d('2026-12-01'), 1)).toEqual([]);
  });

  it('charges the first billed month and advances billed_through', () => {
    const [c] = addonChargesForRenewal([billLater()], d('2026-12-01'), d('2027-01-01'), 1);
    expect(c.amount).toBe(200);
    expect(c.months).toBe(1);
    expect(day(c.billedThrough as Date)).toBe('2027-01-01');
  });

  it('arrears: re-activated mid-cycle is billed 2 months on the next renewal', () => {
    const [c] = addonChargesForRenewal(
      [billLater({ billingStartsOn: d('2026-10-01') })],
      d('2026-11-01'),
      d('2026-12-01'),
      1,
    );
    expect(c.months).toBe(2);
    expect(c.amount).toBe(400);
  });

  it('stops charging at cancel_at', () => {
    expect(
      addonChargesForRenewal(
        [billLater({ billedThrough: d('2027-01-01'), cancelAt: d('2027-01-01') })],
        d('2027-01-01'),
        d('2027-02-01'),
        1,
      ),
    ).toEqual([]);
  });

  it('legacy rows keep price × months and do not touch billed_through', () => {
    const [c] = addonChargesForRenewal(
      [
        {
          id: 'old',
          price: 150,
          billingMode: null,
          billingStartsOn: null,
          billedThrough: null,
          cancelAt: null,
        },
      ],
      d('2026-11-01'),
      d('2027-02-01'),
      3,
    );
    expect(c).toEqual({ id: 'old', months: 3, amount: 450, billedThrough: null });
  });
});

describe('helpers', () => {
  it('vatOnTop adds 7% rounded to satang', () => {
    expect(vatOnTop(1490)).toEqual({ subtotal: 1490, vatRate: 7, vatAmount: 104.3, total: 1594.3 });
    expect(vatOnTop(790)).toEqual({ subtotal: 790, vatRate: 7, vatAmount: 55.3, total: 845.3 });
  });

  it('wholeMonthsBetween rounds a partial last month up', () => {
    expect(wholeMonthsBetween(d('2026-10-01'), d('2026-12-01'))).toBe(2);
    expect(wholeMonthsBetween(d('2026-10-01'), d('2026-10-15'))).toBe(1);
    expect(wholeMonthsBetween(d('2026-10-01'), d('2026-10-01'))).toBe(0);
  });

  it('cancel takes effect at the later of commitment and paid-through', () => {
    expect(
      day(
        cancelEffectiveDate(
          {
            committedUntil: d('2027-01-01'),
            billedThrough: null,
            billingStartsOn: d('2026-12-01'),
          },
          d('2026-10-20'),
        ),
      ),
    ).toBe('2027-01-01');
    expect(
      day(
        cancelEffectiveDate(
          {
            committedUntil: d('2027-01-01'),
            billedThrough: d('2027-03-01'),
            billingStartsOn: d('2026-12-01'),
          },
          d('2027-02-10'),
        ),
      ),
    ).toBe('2027-03-01');
  });

  it('bangkokToday uses the Thai calendar day', () => {
    expect(day(bangkokToday(new Date('2026-10-18T18:30:00Z')))).toBe('2026-10-19');
    expect(day(bangkokToday(new Date('2026-10-18T16:30:00Z')))).toBe('2026-10-18');
  });
});
