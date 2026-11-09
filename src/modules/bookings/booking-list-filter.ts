import { BadRequestException } from '@nestjs/common';
import { bangkokDayRange, toBangkokDate } from '../../common/utils/bangkok-day.util';

/**
 * Query → Prisma `where` for GET /bookings.
 *
 * Date filters cut the day at Bangkok midnight — the same window the dashboard
 * counts with (arrivalsToday / departuresToday). The list used to ignore
 * `checkIn` / `checkOut` entirely, so "เช็คเอาท์วันนี้" on the bookings page and
 * the "เช็คเอาท์วันนี้ 4" card on the hotel dashboard never agreed.
 *
 *  - `checkIn` / `checkOut`  — one day, 'YYYY-MM-DD' or 'today' (resolved on the
 *    server so a client clock in another zone can't shift the day)
 *  - `checkInFrom` / `checkInTo` — inclusive range of check-in days
 *  - `status` — one status or a comma-separated list ('confirmed,pending')
 */
export interface BookingListQuery {
  status?: string;
  guestId?: string;
  roomId?: string;
  propertyId?: string;
  search?: string;
  checkIn?: string;
  checkOut?: string;
  checkInFrom?: string;
  checkInTo?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const resolveDay = (value: string, field: string, now: Date): string => {
  const day = value === 'today' ? toBangkokDate(now) : value;
  if (!DATE_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00.000Z`))) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD or 'today'`);
  }
  return day;
};

const dayWindow = (value: string, field: string, now: Date): { gte: Date; lt: Date } => {
  const { start, end } = bangkokDayRange(resolveDay(value, field, now));
  return { gte: start, lt: end };
};

export function buildBookingListWhere(
  query: BookingListQuery,
  tenantId: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const { status, guestId, roomId, propertyId, search } = query;
  const where: Record<string, unknown> = { tenantId };

  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
  }
  if (guestId) where.guestId = guestId;
  if (roomId) where.roomId = roomId;
  if (propertyId) where.propertyId = propertyId;

  if (query.checkIn) {
    where.checkIn = dayWindow(query.checkIn, 'checkIn', now);
  } else if (query.checkInFrom || query.checkInTo) {
    const range: { gte?: Date; lt?: Date } = {};
    if (query.checkInFrom) range.gte = dayWindow(query.checkInFrom, 'checkInFrom', now).gte;
    if (query.checkInTo) range.lt = dayWindow(query.checkInTo, 'checkInTo', now).lt;
    if (range.gte && range.lt && range.gte >= range.lt) {
      throw new BadRequestException('checkInFrom must not be after checkInTo');
    }
    where.checkIn = range;
  }
  if (query.checkOut) {
    where.checkOut = dayWindow(query.checkOut, 'checkOut', now);
  }

  if (search) {
    where.OR = [
      { guestFirstName: { contains: search } },
      { guestLastName: { contains: search } },
      { guestEmail: { contains: search } },
      { room: { number: { contains: search } } },
    ];
  }

  return where;
}
