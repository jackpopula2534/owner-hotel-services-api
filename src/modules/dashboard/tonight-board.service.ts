import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { bangkokDayRange, shiftDate, toBangkokDate } from '../../common/utils/bangkok-day.util';

/**
 * "ผังคืนนี้ + ความเคลื่อนไหวล่าสุด" for the Owner Console home.
 *
 * One response shape for both product lines so the frontend draws one card:
 *   • HOTEL → rooms grouped by floor
 *   • CAMP  → pitches grouped by zone
 * Each unit gets a single status for *tonight* (the Bangkok night that starts
 * today), and the feed lists real business events (booking, check-in/out,
 * payment, cancellation) instead of raw audit-log lines.
 */

export type ProductLine = 'HOTEL' | 'CAMP';

export type TonightUnitStatus =
  | 'available' // ว่าง พร้อมขาย
  | 'occupied' // มีผู้เข้าพัก (เช็คอินแล้ว)
  | 'arriving' // จองไว้ เข้าวันนี้ ยังไม่เช็คอิน
  | 'reserved' // จองไว้คืนนี้ (ยังไม่เช็คอิน, เข้ามาก่อนวันนี้)
  | 'dirty' // รอทำความสะอาด / ตรวจพื้นที่
  | 'blocked'; // ซ่อม / ปิด

export interface TonightUnit {
  id: string;
  code: string;
  status: TonightUnitStatus;
  guestName?: string;
}

export interface TonightGroup {
  key: string;
  label: string;
  sublabel?: string;
  color?: string | null;
  units: TonightUnit[];
}

export type ActivityKind = 'booked' | 'check_in' | 'check_out' | 'payment' | 'cancelled';

export interface TonightActivity {
  id: string;
  kind: ActivityKind;
  guestName: string;
  unit?: string;
  nights?: number;
  amount?: number;
  method?: string;
  at: string;
}

export interface TonightBoard {
  line: ProductLine;
  date: string;
  groups: TonightGroup[];
  summary: Record<TonightUnitStatus, number> & { total: number };
  activity: TonightActivity[];
}

const BLOCKING = ['pending', 'confirmed', 'checked_in'];

const emptySummary = (): TonightBoard['summary'] => ({
  available: 0,
  occupied: 0,
  arriving: 0,
  reserved: 0,
  dirty: 0,
  blocked: 0,
  total: 0,
});

/** Natural sort so A2 < A10. */
const natural = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' });

const fullName = (first?: string | null, last?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim() || 'ผู้เข้าพัก';

const nightsBetween = (checkIn: Date, checkOut: Date) =>
  Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));

interface StayLike {
  status: string;
  checkIn: Date;
  checkOut: Date;
  guestName: string;
}

/**
 * Status of one unit for tonight. Exported for tests.
 * `unitStatus` is the unit's own housekeeping/maintenance status.
 */
export function resolveTonightStatus(
  unitStatus: string,
  stay: StayLike | undefined,
  todayStart: Date,
): TonightUnitStatus {
  const s = (unitStatus || '').toLowerCase();
  if (['maintenance', 'closed', 'out_of_order', 'blocked'].includes(s)) return 'blocked';
  if (stay) {
    if (stay.status === 'checked_in') return 'occupied';
    return stay.checkIn.getTime() >= todayStart.getTime() ? 'arriving' : 'reserved';
  }
  if (s === 'occupied') return 'occupied';
  if (['dirty', 'cleaning', 'inspect'].includes(s)) return 'dirty';
  return 'available';
}

/**
 * A stay covers tonight when it starts before tomorrow (Bangkok) and ends on or
 * after tomorrow — a guest checking out today is not staying tonight.
 */
export function coversTonight(checkIn: Date, checkOut: Date, tomorrowStart: Date): boolean {
  return checkIn.getTime() < tomorrowStart.getTime() && checkOut.getTime() >= tomorrowStart.getTime();
}

interface PaymentEntry {
  at?: string;
  amount?: number | string;
  method?: string;
}

const parsePayments = (raw: unknown): PaymentEntry[] => {
  if (Array.isArray(raw)) return raw as PaymentEntry[];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

@Injectable()
export class TonightBoardService {
  private readonly logger = new Logger(TonightBoardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getBoard(
    tenantId: string | undefined,
    opts: { line?: string; propertyId?: string; limit?: number; now?: Date } = {},
  ): Promise<TonightBoard> {
    const now = opts.now ?? new Date();
    const date = toBangkokDate(now);
    const line = await this.resolveLine(tenantId, opts.line);
    const empty: TonightBoard = { line, date, groups: [], summary: emptySummary(), activity: [] };
    if (!tenantId) return empty;

    const { start: todayStart } = bangkokDayRange(date);
    const { start: tomorrowStart } = bangkokDayRange(shiftDate(date, 1));
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 30);

    try {
      return line === 'CAMP'
        ? await this.campBoard(tenantId, date, todayStart, tomorrowStart, limit)
        : await this.hotelBoard(tenantId, opts.propertyId, date, todayStart, tomorrowStart, limit);
    } catch (error) {
      this.logger.error(`tonight board failed: ${error instanceof Error ? error.message : error}`);
      return empty;
    }
  }

  /** Caller may say which line; otherwise infer from what the tenant has. */
  private async resolveLine(tenantId: string | undefined, hint?: string): Promise<ProductLine> {
    const h = (hint ?? '').toUpperCase();
    if (h === 'CAMP' || h === 'HOTEL') return h;
    if (!tenantId) return 'HOTEL';
    const [rooms, pitches] = await Promise.all([
      this.prisma.room.count({ where: { tenantId } }).catch(() => 0),
      this.prisma.campPitch.count({ where: { tenantId } }).catch(() => 0),
    ]);
    return pitches > 0 && rooms === 0 ? 'CAMP' : 'HOTEL';
  }

  // ── Campground ────────────────────────────────────────────────────────────

  private async campBoard(
    tenantId: string,
    date: string,
    todayStart: Date,
    tomorrowStart: Date,
    limit: number,
  ): Promise<TonightBoard> {
    const [pitches, stays, recent] = await Promise.all([
      this.prisma.campPitch.findMany({
        where: { tenantId },
        select: {
          id: true,
          code: true,
          status: true,
          zone: { select: { id: true, name: true, code: true, type: true, color: true } },
          campground: { select: { id: true, name: true } },
        },
      }),
      this.prisma.campReservation.findMany({
        where: {
          tenantId,
          status: { in: BLOCKING },
          checkIn: { lt: tomorrowStart },
          checkOut: { gte: tomorrowStart },
        },
        select: {
          pitchId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          guestFirstName: true,
          guestLastName: true,
        },
      }),
      this.prisma.campReservation.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: limit * 3,
        select: {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          actualCheckIn: true,
          actualCheckOut: true,
          createdAt: true,
          updatedAt: true,
          guestFirstName: true,
          guestLastName: true,
          totalPrice: true,
          payments: true,
          pitch: { select: { code: true } },
        },
      }),
    ]);

    const stayByPitch = new Map<string, StayLike>();
    for (const r of stays) {
      if (!coversTonight(r.checkIn, r.checkOut, tomorrowStart)) continue;
      const prev = stayByPitch.get(r.pitchId);
      // checked_in wins over a pending hold on the same pitch
      if (!prev || r.status === 'checked_in') {
        stayByPitch.set(r.pitchId, {
          status: r.status,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          guestName: fullName(r.guestFirstName, r.guestLastName),
        });
      }
    }

    const multiCamp = new Set(pitches.map((p) => p.campground?.id)).size > 1;
    const groupMap = new Map<string, TonightGroup>();
    const summary = emptySummary();

    for (const p of pitches) {
      const key = p.zone?.id ?? 'no-zone';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          label: p.zone?.name ?? 'ไม่ระบุโซน',
          sublabel: multiCamp ? p.campground?.name : (p.zone?.code ?? undefined),
          color: p.zone?.color ?? null,
          units: [],
        });
      }
      const stay = stayByPitch.get(p.id);
      const status = resolveTonightStatus(p.status, stay, todayStart);
      summary[status] += 1;
      summary.total += 1;
      groupMap.get(key)!.units.push({ id: p.id, code: p.code, status, guestName: stay?.guestName });
    }

    const groups = [...groupMap.values()]
      .map((g) => ({ ...g, units: g.units.sort((a, b) => natural(a.code, b.code)) }))
      .sort((a, b) => natural(a.label, b.label));

    const activity: TonightActivity[] = [];
    for (const r of recent) {
      const guestName = fullName(r.guestFirstName, r.guestLastName);
      const unit = r.pitch?.code;
      const nights = nightsBetween(r.checkIn, r.checkOut);
      activity.push({ id: `${r.id}:booked`, kind: 'booked', guestName, unit, nights, amount: Number(r.totalPrice), at: r.createdAt.toISOString() });
      if (r.actualCheckIn) activity.push({ id: `${r.id}:in`, kind: 'check_in', guestName, unit, nights, at: r.actualCheckIn.toISOString() });
      if (r.actualCheckOut) activity.push({ id: `${r.id}:out`, kind: 'check_out', guestName, unit, at: r.actualCheckOut.toISOString() });
      if (r.status === 'cancelled') activity.push({ id: `${r.id}:cancel`, kind: 'cancelled', guestName, unit, at: r.updatedAt.toISOString() });
      parsePayments(r.payments).forEach((pay, i) => {
        if (!pay?.at) return;
        activity.push({
          id: `${r.id}:pay:${i}`,
          kind: 'payment',
          guestName,
          unit,
          nights,
          amount: Number(pay.amount ?? 0),
          method: pay.method,
          at: new Date(pay.at).toISOString(),
        });
      });
    }

    return {
      line: 'CAMP',
      date,
      groups,
      summary,
      activity: activity.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit),
    };
  }

  // ── Hotel ─────────────────────────────────────────────────────────────────

  private async hotelBoard(
    tenantId: string,
    propertyId: string | undefined,
    date: string,
    todayStart: Date,
    tomorrowStart: Date,
    limit: number,
  ): Promise<TonightBoard> {
    const scope: Record<string, unknown> = { tenantId };
    if (propertyId) scope.propertyId = propertyId;

    const [rooms, stays, recent] = await Promise.all([
      this.prisma.room.findMany({
        where: scope,
        select: { id: true, number: true, floor: true, status: true },
      }),
      this.prisma.booking.findMany({
        where: {
          ...scope,
          status: { in: BLOCKING },
          checkIn: { lt: tomorrowStart },
          checkOut: { gte: tomorrowStart },
        },
        select: {
          roomId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          guest: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.booking.findMany({
        where: scope,
        orderBy: { updatedAt: 'desc' },
        take: limit * 2,
        select: {
          id: true,
          status: true,
          checkIn: true,
          checkOut: true,
          actualCheckIn: true,
          actualCheckOut: true,
          createdAt: true,
          updatedAt: true,
          totalPrice: true,
          guest: { select: { firstName: true, lastName: true } },
          room: { select: { number: true } },
        },
      }),
    ]);

    const stayByRoom = new Map<string, StayLike>();
    for (const b of stays) {
      if (!coversTonight(b.checkIn, b.checkOut, tomorrowStart)) continue;
      const prev = stayByRoom.get(b.roomId);
      if (!prev || b.status === 'checked_in') {
        stayByRoom.set(b.roomId, {
          status: b.status,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          guestName: fullName(b.guest?.firstName, b.guest?.lastName),
        });
      }
    }

    const groupMap = new Map<number, TonightGroup>();
    const summary = emptySummary();
    for (const r of rooms) {
      const floor = r.floor || 1;
      if (!groupMap.has(floor)) groupMap.set(floor, { key: `floor-${floor}`, label: `ชั้น ${floor}`, units: [] });
      const stay = stayByRoom.get(r.id);
      const status = resolveTonightStatus(r.status, stay, todayStart);
      summary[status] += 1;
      summary.total += 1;
      groupMap.get(floor)!.units.push({ id: r.id, code: r.number, status, guestName: stay?.guestName });
    }
    const groups = [...groupMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, g]) => ({ ...g, units: g.units.sort((a, b) => natural(a.code, b.code)) }));

    const activity: TonightActivity[] = [];
    for (const b of recent) {
      const guestName = fullName(b.guest?.firstName, b.guest?.lastName);
      const unit = b.room?.number;
      const nights = nightsBetween(b.checkIn, b.checkOut);
      activity.push({ id: `${b.id}:booked`, kind: 'booked', guestName, unit, nights, amount: Number(b.totalPrice), at: b.createdAt.toISOString() });
      if (b.actualCheckIn) activity.push({ id: `${b.id}:in`, kind: 'check_in', guestName, unit, nights, at: b.actualCheckIn.toISOString() });
      if (b.actualCheckOut) activity.push({ id: `${b.id}:out`, kind: 'check_out', guestName, unit, at: b.actualCheckOut.toISOString() });
      if (b.status === 'cancelled') activity.push({ id: `${b.id}:cancel`, kind: 'cancelled', guestName, unit, at: b.updatedAt.toISOString() });
    }

    return {
      line: 'HOTEL',
      date,
      groups,
      summary,
      activity: activity.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit),
    };
  }
}
