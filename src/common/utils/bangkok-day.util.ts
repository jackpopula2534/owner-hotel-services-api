/**
 * Bangkok calendar helpers.
 *
 * Every report a Thai operator reads — a day's takings, a month's overview, the
 * cross-system Command Center — has to cut the day where the business does, at
 * Bangkok midnight, not at UTC midnight. Thailand has observed UTC+7 year-round
 * since 1940 with no DST, so a fixed offset is exact and needs no tz database.
 *
 * These live in `common/` rather than inside one module because two modules that
 * each define "today" slightly differently produce two totals that never
 * reconcile, and the mismatch is invisible until someone counts the till.
 */

/** Milliseconds in one calendar day. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Bangkok is UTC+7 year-round (Thailand has no DST), so a fixed offset is exact. */
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Money rounding — two decimals, half away from zero. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Bangkok calendar day containing `at`, as 'YYYY-MM-DD'. */
export const toBangkokDate = (at: Date): string =>
  new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().split('T')[0];

/** Bangkok calendar month containing `at`, as 'YYYY-MM'. */
export const toBangkokMonth = (at: Date): string => toBangkokDate(at).slice(0, 7);

/** Half-open [start, end) UTC window covering one Bangkok calendar day. */
export const bangkokDayRange = (date: string): { start: Date; end: Date } => {
  const start = new Date(new Date(`${date}T00:00:00.000Z`).getTime() - BANGKOK_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

/**
 * Half-open [start, end) UTC window covering one Bangkok calendar month.
 * Built from the calendar rather than by adding 30 days, so February and the
 * 31-day months are exact.
 */
export const bangkokMonthRange = (month: string): { start: Date; end: Date } => {
  const [year, index] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, index - 1, 1) - BANGKOK_OFFSET_MS);
  const end = new Date(Date.UTC(year, index, 1) - BANGKOK_OFFSET_MS);
  return { start, end };
};

/** 'YYYY-MM-DD' shifted by whole days, crossing month and year boundaries. */
export const shiftDate = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .split('T')[0];

/** 'YYYY-MM' shifted by whole months, wrapping the year correctly. */
export const shiftMonth = (month: string, months: number): string => {
  const [year, index] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, index - 1 + months, 1));
  return shifted.toISOString().slice(0, 7);
};

/** Every Bangkok calendar day in `month`, in order, as 'YYYY-MM-DD'. */
export const daysOfMonth = (month: string): string[] => {
  const [year, index] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
};

/** Hour 0–23 of the Bangkok clock at instant `at`. */
export const bangkokHour = (at: Date): number =>
  new Date(at.getTime() + BANGKOK_OFFSET_MS).getUTCHours();
