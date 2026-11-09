import {
  applyCleaningBuffer,
  BANGKOK_OFFSET,
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  doBookingsOverlap,
  isRoomBookableForFuture,
  resolveTimeWithFallback,
  UNBOOKABLE_ROOM_STATUSES,
} from './availability.util';

describe('availability.util constants', () => {
  it('exports sensible defaults', () => {
    expect(BANGKOK_OFFSET).toBe('+07:00');
    expect(DEFAULT_CHECK_IN_TIME).toBe('14:00');
    expect(DEFAULT_CHECK_OUT_TIME).toBe('12:00');
    expect(DEFAULT_CLEANING_BUFFER_MINUTES).toBe(60);
    expect(UNBOOKABLE_ROOM_STATUSES).toEqual(['maintenance', 'out_of_order']);
  });
});

describe('resolveTimeWithFallback', () => {
  it('prefers user time when present', () => {
    expect(resolveTimeWithFallback('10:00', '14:00', '12:00')).toBe('10:00');
  });

  it('falls back to property time when user time is null/empty', () => {
    expect(resolveTimeWithFallback(null, '15:00', '12:00')).toBe('15:00');
    expect(resolveTimeWithFallback('', '15:00', '12:00')).toBe('15:00');
    expect(resolveTimeWithFallback(undefined, '15:00', '12:00')).toBe('15:00');
  });

  it('falls back to default when both user and property times are missing', () => {
    expect(resolveTimeWithFallback(undefined, undefined, '12:00')).toBe('12:00');
    expect(resolveTimeWithFallback('', '', '12:00')).toBe('12:00');
    expect(resolveTimeWithFallback(null, null, '12:00')).toBe('12:00');
  });

  it('treats whitespace-only strings as absent', () => {
    expect(resolveTimeWithFallback('   ', '14:00', '12:00')).toBe('14:00');
  });
});

describe('buildBangkokDateTime', () => {
  it('builds a Bangkok-local datetime from date-only + time', () => {
    const result = buildBangkokDateTime('2026-05-14', '14:00');
    // 14:00 BKK = 07:00 UTC
    expect(result.toISOString()).toBe('2026-05-14T07:00:00.000Z');
  });

  it('handles single-digit hours by padding', () => {
    const result = buildBangkokDateTime('2026-05-14', '9:30');
    expect(result.toISOString()).toBe('2026-05-14T02:30:00.000Z');
  });

  it('passes a full ISO string through unchanged', () => {
    const isoIn = '2026-05-14T10:00:00.000Z';
    const result = buildBangkokDateTime(isoIn, 'unused');
    expect(result.toISOString()).toBe(isoIn);
  });

  it('throws on invalid date format', () => {
    expect(() => buildBangkokDateTime('14/05/2026', '14:00')).toThrow(/YYYY-MM-DD/);
  });

  it('throws on missing or invalid time when input is date-only', () => {
    expect(() => buildBangkokDateTime('2026-05-14', '')).toThrow(/HH:mm/);
    expect(() => buildBangkokDateTime('2026-05-14', '25:00')).toThrow(/out of range/);
    expect(() => buildBangkokDateTime('2026-05-14', '12:60')).toThrow(/out of range/);
  });

  it('throws on missing date input', () => {
    expect(() => buildBangkokDateTime('', '14:00')).toThrow();
    expect(() => buildBangkokDateTime(undefined as unknown as string, '14:00')).toThrow();
  });

  it('throws on malformed ISO string', () => {
    expect(() => buildBangkokDateTime('2026-13-99T99:99:99Z', 'unused')).toThrow(/invalid ISO/);
  });
});

describe('applyCleaningBuffer', () => {
  const checkIn = new Date('2026-05-14T07:00:00.000Z'); // 14:00 BKK
  const checkOut = new Date('2026-05-15T05:00:00.000Z'); // 12:00 BKK next day

  it('expands the window symmetrically by buffer minutes', () => {
    const { overlapStart, overlapEnd } = applyCleaningBuffer(checkIn, checkOut, 60);
    expect(overlapStart.toISOString()).toBe('2026-05-14T06:00:00.000Z'); // 13:00 BKK
    expect(overlapEnd.toISOString()).toBe('2026-05-15T06:00:00.000Z'); // 13:00 BKK
  });

  it('returns the unchanged window when buffer is 0', () => {
    const { overlapStart, overlapEnd } = applyCleaningBuffer(checkIn, checkOut, 0);
    expect(overlapStart).toEqual(checkIn);
    expect(overlapEnd).toEqual(checkOut);
  });

  it('treats negative or NaN buffer as 0 (defensive)', () => {
    const { overlapStart, overlapEnd } = applyCleaningBuffer(checkIn, checkOut, -100);
    expect(overlapStart).toEqual(checkIn);
    expect(overlapEnd).toEqual(checkOut);

    const nanResult = applyCleaningBuffer(checkIn, checkOut, NaN);
    expect(nanResult.overlapStart).toEqual(checkIn);
    expect(nanResult.overlapEnd).toEqual(checkOut);
  });

  it('throws if checkOut is not strictly after checkIn', () => {
    expect(() => applyCleaningBuffer(checkOut, checkIn, 60)).toThrow(/after checkIn/);
    expect(() => applyCleaningBuffer(checkIn, checkIn, 60)).toThrow(/after checkIn/);
  });

  it('throws on invalid Date inputs', () => {
    const bad = new Date('not a date');
    expect(() => applyCleaningBuffer(bad, checkOut, 60)).toThrow();
    expect(() => applyCleaningBuffer(checkIn, bad, 60)).toThrow();
  });
});

describe('doBookingsOverlap', () => {
  // Helper: the original guest (Alexander Harris) — May 13 14:00 → May 14 12:00 BKK
  const alexanderHarris = {
    start: new Date('2026-05-13T07:00:00.000Z'),
    end: new Date('2026-05-14T05:00:00.000Z'),
  };
  // New request — May 14 14:00 → May 15 12:00 BKK
  const newRequest14To15 = {
    start: new Date('2026-05-14T07:00:00.000Z'),
    end: new Date('2026-05-15T05:00:00.000Z'),
  };

  it('returns false when previous stay ends 2h before new check-in (gap > 60min buffer)', () => {
    expect(doBookingsOverlap(alexanderHarris, newRequest14To15, 60)).toBe(false);
  });

  it('returns true when gap (30min) < buffer (60min)', () => {
    const tightRequest = {
      start: new Date('2026-05-14T05:30:00.000Z'), // 12:30 BKK
      end: new Date('2026-05-15T05:00:00.000Z'),
    };
    expect(doBookingsOverlap(alexanderHarris, tightRequest, 60)).toBe(true);
  });

  it('returns true when exactly the same window', () => {
    expect(doBookingsOverlap(alexanderHarris, alexanderHarris, 60)).toBe(true);
  });

  it('returns true when new booking starts before existing ends (true overlap)', () => {
    const overlappingRequest = {
      start: new Date('2026-05-13T20:00:00.000Z'), // mid-stay of Alexander
      end: new Date('2026-05-14T10:00:00.000Z'),
    };
    expect(doBookingsOverlap(alexanderHarris, overlappingRequest, 60)).toBe(true);
  });

  it('returns false for two stays with zero buffer when they are perfectly adjacent', () => {
    const adjacent = {
      start: alexanderHarris.end, // starts exactly when previous ends
      end: new Date('2026-05-15T05:00:00.000Z'),
    };
    expect(doBookingsOverlap(alexanderHarris, adjacent, 0)).toBe(false);
  });

  it('returns true for adjacent bookings when buffer > 0 (no cleaning time)', () => {
    const adjacent = {
      start: alexanderHarris.end, // 12:00 BKK = exactly when Alexander leaves
      end: new Date('2026-05-15T05:00:00.000Z'),
    };
    expect(doBookingsOverlap(alexanderHarris, adjacent, 60)).toBe(true);
  });

  it('detects overlap from the OTHER side too (existing starts inside new window + buffer)', () => {
    // Existing booking that starts AFTER new request ends but within buffer
    const upcomingBooking = {
      start: new Date('2026-05-15T05:30:00.000Z'), // 12:30 BKK
      end: new Date('2026-05-16T05:00:00.000Z'),
    };
    // New request ends 12:00 BKK, upcoming starts 12:30 BKK → 30min gap < 60min buffer
    expect(doBookingsOverlap(upcomingBooking, newRequest14To15, 60)).toBe(true);
  });

  it('honors a larger buffer (180min)', () => {
    // Gap is 2h; buffer is 3h → not enough time
    expect(doBookingsOverlap(alexanderHarris, newRequest14To15, 180)).toBe(true);
  });
});

describe('isRoomBookableForFuture', () => {
  it.each([
    ['available', true],
    ['occupied', true],
    ['cleaning', true],
    ['dirty', true],
    ['inspected', true],
    [undefined, true],
    [null, true],
    ['', true],
    ['maintenance', false],
    ['out_of_order', false],
  ] as Array<[string | null | undefined, boolean]>)(
    'status %p → bookable=%s',
    (status, expected) => {
      expect(isRoomBookableForFuture(status)).toBe(expected);
    },
  );
});

describe('integration scenario — original user report', () => {
  it('Alexander Harris 13→14 with checkout 12:00 BKK does not block a 14→15 booking at 14:00 (60min buffer)', () => {
    const existing = {
      start: buildBangkokDateTime('2026-05-13', '14:00'),
      end: buildBangkokDateTime('2026-05-14', '12:00'),
    };
    const requested = {
      start: buildBangkokDateTime('2026-05-14', '14:00'),
      end: buildBangkokDateTime('2026-05-15', '12:00'),
    };

    expect(doBookingsOverlap(existing, requested, 60)).toBe(false);
  });

  it('but it DOES block a 12:30 check-in attempt (only 30min after previous checkout)', () => {
    const existing = {
      start: buildBangkokDateTime('2026-05-13', '14:00'),
      end: buildBangkokDateTime('2026-05-14', '12:00'),
    };
    const earlyRequest = {
      start: buildBangkokDateTime('2026-05-14', '12:30'),
      end: buildBangkokDateTime('2026-05-15', '12:00'),
    };

    expect(doBookingsOverlap(existing, earlyRequest, 60)).toBe(true);
  });
});
