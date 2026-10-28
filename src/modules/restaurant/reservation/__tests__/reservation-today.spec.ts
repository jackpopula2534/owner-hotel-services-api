/**
 * "Today" for table bookings is the restaurant's calendar day (Bangkok), not
 * the server's. On a UTC server the two disagree from 00:00 to 07:00 local —
 * exactly when a late bar is still open — and today's bookings vanished from
 * the floor until morning.
 */

import { isToday, today } from '../reservation-slot.util';

describe('reservation day boundaries (Asia/Bangkok)', () => {
  it('is already the new Bangkok day at 00:30 local, even on a UTC server', () => {
    // 2026-10-27 00:30 in Bangkok = 2026-10-26 17:30 UTC
    expect(today(new Date('2026-10-26T17:30:00Z')).toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });

  it('is still the same Bangkok day at 23:30 local', () => {
    // 2026-10-27 23:30 in Bangkok = 2026-10-27 16:30 UTC
    expect(today(new Date('2026-10-27T16:30:00Z')).toISOString()).toBe('2026-10-27T00:00:00.000Z');
  });

  it('matches a stored @db.Date for the Bangkok day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-26T18:00:00Z')); // 01:00 on the 27th in Bangkok
    try {
      expect(isToday(new Date('2026-10-27T00:00:00.000Z'))).toBe(true);
      expect(isToday(new Date('2026-10-26T00:00:00.000Z'))).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
