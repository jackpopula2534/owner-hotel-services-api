/**
 * Pure helper for converting any Date into the Bangkok-calendar "YYYY-MM-DD"
 * string. Lives here (rather than inline in the backfill script) so it can be
 * unit-tested and reused.
 */
export function toBangkokDateString(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('toBangkokDateString: invalid Date');
  }
  // Bangkok is UTC+7. Adding 7 hours shifts UTC midnight → Bangkok midnight,
  // so the resulting UTC date string equals the Bangkok calendar day.
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().split('T')[0];
}
