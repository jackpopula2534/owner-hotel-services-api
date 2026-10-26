import { quotaCycle, quotaPeriod } from './addon-quota.constants';

describe('quotaCycle', () => {
  it('anchored: activated Oct 30 → cycle runs to Nov 30 (no reset on the 1st)', () => {
    const anchor = new Date('2026-10-29T17:00:00Z'); // 30 ต.ค. 00:00 เวลาไทย
    const c = quotaCycle(new Date('2026-11-02T05:00:00Z'), anchor);
    expect(c.start.toISOString()).toBe('2026-10-29T17:00:00.000Z');
    expect(c.end.toISOString()).toBe('2026-11-29T17:00:00.000Z');
  });

  it('anchored: rolls into the next cycle exactly at the anchor day', () => {
    const anchor = new Date('2026-10-29T17:00:00Z');
    const c = quotaCycle(new Date('2026-11-29T17:00:00Z'), anchor);
    expect(c.start.toISOString()).toBe('2026-11-29T17:00:00.000Z');
  });

  it('anchored: month-end anchor clamps (Jan 31 → Feb 28)', () => {
    const anchor = new Date('2027-01-30T17:00:00Z'); // 31 ม.ค. เวลาไทย
    const c = quotaCycle(new Date('2027-02-10T00:00:00Z'), anchor);
    expect(c.start.toISOString()).toBe('2027-01-30T17:00:00.000Z');
    expect(c.end.getTime()).toBeLessThan(new Date('2027-03-01T00:00:00Z').getTime());
  });

  it('no anchor: Bangkok calendar month, resets at 00:00 Thai time (not 07:00)', () => {
    const c = quotaCycle(new Date('2026-10-31T18:00:00Z'), null); // 1 พ.ย. 01:00 เวลาไทย
    expect(c.period).toBe('2026-11');
    expect(c.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(quotaPeriod(new Date('2026-10-31T16:00:00Z'))).toBe('2026-10');
  });

  it('future anchor falls back to the calendar month', () => {
    const c = quotaCycle(new Date('2026-10-19T00:00:00Z'), new Date('2026-12-01T00:00:00Z'));
    expect(c.period).toBe('2026-10');
  });
});
