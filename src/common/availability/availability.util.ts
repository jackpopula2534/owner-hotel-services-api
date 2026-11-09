/**
 * Availability utility — pure functions for room/booking availability math.
 *
 * Design rules:
 * - No NestJS, no Prisma, no I/O. Pure inputs → outputs.
 * - All times are interpreted in Bangkok timezone (UTC+7) unless caller
 *   supplies an already-resolved Date.
 * - These functions are the single source of truth used by:
 *     - RoomsService.getAvailableRooms
 *     - BookingsService.create (overlap pre-check + scheduledCheck* persistence)
 *     - RoomAvailabilityService.checkRoomAvailable
 */

/** Bangkok timezone offset used throughout the system. */
export const BANGKOK_OFFSET = '+07:00';

/** Default times when neither user input nor property settings provide one. */
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';
export const DEFAULT_CLEANING_BUFFER_MINUTES = 60;

/**
 * Room statuses that cannot accept future bookings regardless of date overlap.
 * Bookable statuses (available, occupied, cleaning, dirty) all can still hold
 * a future reservation as long as no booking-window overlap exists.
 */
export const UNBOOKABLE_ROOM_STATUSES: readonly string[] = ['maintenance', 'out_of_order'];

/**
 * Resolve a time string with a three-level fallback:
 *   userTime → propertyTime → defaultTime
 * Treats null / undefined / empty-string as "absent" so falsy fallbacks work.
 */
export function resolveTimeWithFallback(
  userTime: string | null | undefined,
  propertyTime: string | null | undefined,
  defaultTime: string,
): string {
  if (userTime && userTime.trim().length > 0) return userTime;
  if (propertyTime && propertyTime.trim().length > 0) return propertyTime;
  return defaultTime;
}

/**
 * Build a Date in Bangkok timezone from either:
 *   - a full ISO-8601 string (containing 'T') — used as-is
 *   - a date-only string "YYYY-MM-DD" combined with the supplied time
 *
 * Throws if the inputs don't yield a valid Date.
 *
 * Examples:
 *   buildBangkokDateTime('2026-05-14', '14:00')
 *     → new Date('2026-05-14T14:00:00+07:00')  (= 07:00 UTC)
 *   buildBangkokDateTime('2026-05-14T10:00:00.000Z', 'whatever')
 *     → new Date('2026-05-14T10:00:00.000Z')
 */
export function buildBangkokDateTime(dateOrIso: string, time: string): Date {
  if (!dateOrIso || typeof dateOrIso !== 'string') {
    throw new Error('buildBangkokDateTime: date string is required');
  }

  if (dateOrIso.includes('T')) {
    const parsed = new Date(dateOrIso);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`buildBangkokDateTime: invalid ISO string "${dateOrIso}"`);
    }
    return parsed;
  }

  const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnlyRegex.test(dateOrIso)) {
    throw new Error(`buildBangkokDateTime: expected YYYY-MM-DD, got "${dateOrIso}"`);
  }

  const timeRegex = /^(\d{1,2}):(\d{2})$/;
  const match = timeRegex.exec(time ?? '');
  if (!match) {
    throw new Error(`buildBangkokDateTime: expected HH:mm time, got "${time}"`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`buildBangkokDateTime: time out of range "${time}"`);
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return new Date(`${dateOrIso}T${hh}:${mm}:00${BANGKOK_OFFSET}`);
}

export interface CleaningBufferWindow {
  /** New booking's check-in extended backwards by the buffer. */
  overlapStart: Date;
  /** New booking's check-out extended forwards by the buffer. */
  overlapEnd: Date;
}

/**
 * Expand a requested booking window by the cleaning buffer on both sides.
 * Use this to drive a Prisma overlap query:
 *
 *   existing.scheduledCheckIn < window.overlapEnd  AND
 *   existing.scheduledCheckOut > window.overlapStart
 *
 * The symmetric expansion guarantees the maid has `bufferMinutes` of clearance
 * BEFORE the new check-in AND AFTER the new check-out, regardless of which
 * neighbour booking we're comparing against.
 */
export function applyCleaningBuffer(
  checkIn: Date,
  checkOut: Date,
  bufferMinutes: number,
): CleaningBufferWindow {
  if (!(checkIn instanceof Date) || Number.isNaN(checkIn.getTime())) {
    throw new Error('applyCleaningBuffer: checkIn must be a valid Date');
  }
  if (!(checkOut instanceof Date) || Number.isNaN(checkOut.getTime())) {
    throw new Error('applyCleaningBuffer: checkOut must be a valid Date');
  }
  if (checkOut <= checkIn) {
    throw new Error('applyCleaningBuffer: checkOut must be after checkIn');
  }

  const rawBuffer = Number.isFinite(bufferMinutes) ? Math.floor(bufferMinutes as number) : 0;
  const safeBuffer = Math.max(0, rawBuffer);
  const bufferMs = safeBuffer * 60 * 1000;

  return {
    overlapStart: new Date(checkIn.getTime() - bufferMs),
    overlapEnd: new Date(checkOut.getTime() + bufferMs),
  };
}

export interface BookingInterval {
  start: Date;
  end: Date;
}

/**
 * Pure overlap check between an existing booking and a requested booking,
 * with a cleaning buffer applied symmetrically. Returns `true` if the rooms
 * cannot coexist.
 *
 * Equivalent to:
 *   existing.start < (requested.end + buffer)  AND
 *   existing.end   > (requested.start - buffer)
 */
export function doBookingsOverlap(
  existing: BookingInterval,
  requested: BookingInterval,
  bufferMinutes: number,
): boolean {
  const { overlapStart, overlapEnd } = applyCleaningBuffer(
    requested.start,
    requested.end,
    bufferMinutes,
  );
  return existing.start < overlapEnd && existing.end > overlapStart;
}

/**
 * Whether a room's CURRENT status should disqualify it from FUTURE bookings.
 * Returns `true` for bookable statuses (available, occupied, cleaning, dirty,
 * unknown/empty), `false` only for explicitly unbookable ones (maintenance,
 * out_of_order). This decoupling is what allows the system to accept a
 * reservation while the room is still occupied or being cleaned today.
 */
export function isRoomBookableForFuture(status: string | null | undefined): boolean {
  if (!status) return true;
  return !UNBOOKABLE_ROOM_STATUSES.includes(status);
}
