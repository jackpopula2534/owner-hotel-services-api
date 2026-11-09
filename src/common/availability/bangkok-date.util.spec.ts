import { toBangkokDateString } from './bangkok-date.util';

describe('toBangkokDateString', () => {
  it('returns the same calendar day when the Date is already Bangkok-aligned', () => {
    // 2026-05-14T07:00:00.000Z = 14:00 Bangkok on May 14
    expect(toBangkokDateString(new Date('2026-05-14T07:00:00.000Z'))).toBe('2026-05-14');
  });

  it('rolls a late-night UTC time forward into the next Bangkok day', () => {
    // 2026-05-13T18:00:00.000Z = 01:00 Bangkok on May 14
    expect(toBangkokDateString(new Date('2026-05-13T18:00:00.000Z'))).toBe('2026-05-14');
  });

  it('handles exact Bangkok midnight (UTC 17:00 of previous day)', () => {
    // 2026-05-13T17:00:00.000Z = 00:00 Bangkok on May 14
    expect(toBangkokDateString(new Date('2026-05-13T17:00:00.000Z'))).toBe('2026-05-14');
  });

  it('handles UTC midnight (which is 07:00 Bangkok of the same day)', () => {
    expect(toBangkokDateString(new Date('2026-05-14T00:00:00.000Z'))).toBe('2026-05-14');
  });

  it('throws on invalid Date', () => {
    expect(() => toBangkokDateString(new Date('not a date'))).toThrow();
    expect(() => toBangkokDateString(undefined as unknown as Date)).toThrow();
  });
});
