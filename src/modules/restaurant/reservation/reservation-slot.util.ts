/**
 * Shared time-slot rules for table reservations. Both booking creation and the
 * availability lookup must agree on what "taken" means, so the comparison lives
 * here rather than being reimplemented per call site.
 */

/** Statuses that still hold the table — anything else has released it. */
export const BLOCKING_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;

/** How long an open-ended reservation (no endTime) is assumed to hold the table. */
export const DEFAULT_SLOT_MINUTES = 90;

export interface TimeRange {
  start: number;
  end: number;
}

export function toMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Turn a reservation's start/end into a comparable minute range. An open-ended
 * or malformed endTime falls back to a default slot so the table is still held.
 */
export function toRange(startTime: string, endTime?: string | null): TimeRange | null {
  const start = toMinutes(startTime);
  if (start === null) return null;

  const parsedEnd = toMinutes(endTime);
  const end = parsedEnd !== null && parsedEnd > start ? parsedEnd : start + DEFAULT_SLOT_MINUTES;

  return { start, end };
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Normalize a reservation date to UTC midnight — the exact value Prisma writes to
 * and reads back from a `@db.Date` column. Normalizing to *local* midnight instead
 * shifts the stored day by one in any non-UTC zone, which silently breaks both the
 * same-day equality filters and the "is this booking for today" check.
 */
export function startOfDay(value: string | Date): Date {
  if (typeof value === 'string') {
    const parts = DATE_ONLY.exec(value.trim());
    if (parts) {
      return new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    }
  }

  const date = new Date(value);
  const asUtcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

  // A `@db.Date` value comes back as exact UTC midnight, so it already names its day.
  // Anything else is a wall-clock instant and the local calendar day is what is meant.
  return date.getTime() === asUtcDay
    ? new Date(asUtcDay)
    : new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** Today's calendar day (server local time), normalized the same way as stored dates. */
export function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function isToday(date: Date): boolean {
  return startOfDay(date).getTime() === today().getTime();
}
