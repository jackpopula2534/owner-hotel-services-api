import { Injectable } from '@nestjs/common';
import { Prisma, RevenueSourceModule, RevenueType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { shiftDate, toBangkokDate } from '../../common/utils/bangkok-day.util';
import { RevenueFilter, RevenueQueryService } from '../revenue/revenue-query.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DashboardPeriod = 'today' | 'week' | 'month' | 'quarter';

/** จำนวนวันย้อนหลังของแต่ละช่วง (today = วันนี้วันเดียว) */
const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  today: 1,
  week: 7,
  month: 30,
  quarter: 90,
};

/** จำนวนจุดบนกราฟ trend (today แสดงย้อน 7 วันเพื่อให้เห็นบริบท) */
const TREND_DAYS: Record<DashboardPeriod, number> = {
  today: 7,
  week: 7,
  month: 30,
  quarter: 90,
};

/** สถานะที่ถือว่า "เข้าพักจริง/ผูกจุด" สำหรับคำนวณ occupancy */
const OCCUPYING = ['confirmed', 'checked_in', 'checked_out'];
/** สถานะที่ยังไม่จบ (ใช้คิดยอดค้างชำระ) */
const ACTIVEISH = ['pending', 'confirmed', 'checked_in', 'checked_out'];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dateKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}
function nights(a: Date, b: Date): number {
  return Math.max(0, Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000));
}
/** จำนวนคืนของการจองที่ทับกับช่วง [start,end) */
function overlapNights(ci: Date, co: Date, start: Date, end: Date): number {
  const s = Math.max(startOfDay(ci).getTime(), start.getTime());
  const e = Math.min(startOfDay(co).getTime(), end.getTime());
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

const num = (v: Prisma.Decimal | number | null | undefined): number => (v == null ? 0 : Number(v));

const ZONE_LABELS: Record<string, string> = {
  mountain_view: 'วิวภูเขา',
  riverside: 'ริมน้ำ',
  lawn: 'ลานหญ้า',
  rv: 'โซน RV',
  glamping: 'Glamping',
};

type ResWithRel = Prisma.CampReservationGetPayload<{
  include: {
    pitch: { include: { zone: { select: { id: true; name: true; type: true } } } };
    addonItems: true;
  };
}>;

/** ช่องของสมุดรายได้ที่เป็นของลานนี้ (ไม่รวมช่วงวัน — แต่ละบล็อกถามคนละช่วง) */
type LedgerScope = Pick<RevenueFilter, 'tenantId' | 'sourceModule' | 'outletId'>;

/** ช่วงวันธุรกิจไทยแบบรวมปลายทั้งสองข้าง */
interface DayRange {
  from: string;
  to: string;
}

/** ทุกวันในช่วง (รวมปลาย) — ไว้เติมวันที่ไม่มียอดให้กราฟไม่ขาดจุด */
const daysBetween = (range: DayRange): string[] => {
  const out: string[] = [];
  for (let day = range.from; day <= range.to; day = shiftDate(day, 1)) out.push(day);
  return out;
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CampDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueQueryService,
  ) {}

  async getStats(
    params: { campgroundId?: string; period?: string },
    tenantId?: string,
  ) {
    const empty = this.emptyResponse(params.period);
    if (!tenantId) return { success: true, data: empty };

    const period = this.normalizePeriod(params.period);
    const now = new Date();
    const todayStart = startOfDay(now);
    const kpiStart = period === 'today' ? todayStart : addDays(todayStart, -(PERIOD_DAYS[period] - 1));
    const rangeEnd = addDays(todayStart, 1); // exclusive end = พรุ่งนี้ 00:00
    const trendStart = addDays(todayStart, -(TREND_DAYS[period] - 1));
    // ดึงข้อมูลให้ครอบคลุมทั้ง kpi และ trend (เลือกช่วงที่กว้างกว่า)
    const dataStart = kpiStart < trendStart ? kpiStart : trendStart;

    const scope: Prisma.CampReservationWhereInput = {
      tenantId,
      ...(params.campgroundId ? { campgroundId: params.campgroundId } : {}),
    };

    // ── Reservations ที่เกี่ยวข้อง (checkIn ในช่วง / createdAt ในช่วง / ทับช่วง trend) ──
    const reservations = (await this.prisma.campReservation.findMany({
      where: {
        ...scope,
        OR: [
          { checkIn: { gte: dataStart, lt: rangeEnd } },
          { createdAt: { gte: dataStart, lt: rangeEnd } },
          { AND: [{ checkIn: { lt: rangeEnd } }, { checkOut: { gt: dataStart } }] },
        ],
      },
      include: {
        pitch: { include: { zone: { select: { id: true, name: true, type: true } } } },
        addonItems: true,
      },
      orderBy: { createdAt: 'desc' },
    })) as ResWithRel[];

    // ── Master data (snapshot ปัจจุบัน) ──
    const pitchScope: Prisma.CampPitchWhereInput = {
      tenantId,
      ...(params.campgroundId ? { campgroundId: params.campgroundId } : {}),
    };
    const [pitches, addons, requisitions, facilities, outstandingRes] = await Promise.all([
      this.prisma.campPitch.findMany({
        where: pitchScope,
        select: { id: true, status: true, zone: { select: { name: true, type: true } } },
      }),
      this.prisma.campAddon.findMany({
        where: { tenantId, ...(params.campgroundId ? { campgroundId: params.campgroundId } : {}), active: true },
        include: { items: { where: { reservation: { status: { in: ACTIVEISH } } }, select: { qty: true } } },
      }),
      this.prisma.campRequisition.findMany({
        where: { tenantId, ...(params.campgroundId ? { campgroundId: params.campgroundId } : {}) },
        include: { items: { select: { name: true, qty: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.campFacility.findMany({
        where: { tenantId, ...(params.campgroundId ? { campgroundId: params.campgroundId } : {}) },
        select: { id: true, name: true, type: true, status: true },
      }),
      this.prisma.campReservation.findMany({
        where: {
          ...scope,
          status: { in: ACTIVEISH },
          NOT: { paymentStatus: 'paid' },
        },
        select: {
          id: true, reservationNo: true, guestFirstName: true, guestLastName: true,
          totalPrice: true, amountPaid: true, checkIn: true, status: true,
        },
        orderBy: { checkIn: 'asc' },
        take: 12,
      }),
    ]);

    const totalPitches = pitches.length;

    // ── เงินทุกบาทมาจากสมุดรายได้ ──
    // ลานรับรู้รายได้ตอนเช็คเอาต์ (`actualCheckOut ?? checkOut`) ไม่ใช่ตอนเช็คอิน
    // ที่หน้านี้เคยนับ — การจองที่ยังพักอยู่จึงไม่โผล่เป็นยอดขายจนกว่าแขกจะออก
    // ตรงกับที่รายงานรายได้และงบบัญชีเห็น
    const ledgerScope: LedgerScope = {
      tenantId,
      sourceModule: RevenueSourceModule.CAMP,
      ...(params.campgroundId ? { outletId: params.campgroundId } : {}),
    };
    const today = toBangkokDate(now);
    const kpiRange: DayRange = { from: shiftDate(today, -(PERIOD_DAYS[period] - 1)), to: today };
    const trendRange: DayRange = { from: shiftDate(today, -(TREND_DAYS[period] - 1)), to: today };

    const revenue = await this.buildRevenue(ledgerScope, kpiRange, trendRange, outstandingRes, todayStart);

    return {
      success: true,
      data: {
        period,
        range: { start: kpiStart.toISOString(), end: now.toISOString() },
        totals: { totalPitches, totalReservations: reservations.length },
        revenue,
        occupancy: this.buildOccupancy(reservations, totalPitches, pitches, kpiStart, rangeEnd, trendStart, todayStart, revenue.lodging),
        bookings: this.buildBookings(reservations, kpiStart, rangeEnd, trendStart, todayStart),
        inventory: this.buildInventory(addons, requisitions),
        operations: this.buildOperations(reservations, pitches, facilities, todayStart),
      },
    };
  }

  // ── Revenue ──
  /**
   * ยอดขายของลาน — อ่านจากสมุดรายได้ทั้งหมด ไม่ได้บวก `totalPrice` เองแล้ว
   *
   * ที่ต้องเปลี่ยนเพราะหน้านี้เคยนับตาม `checkIn` และเงื่อนไขสถานะของตัวเอง ส่วน
   * รายงานรายได้กับบัญชีนับตอนเช็คเอาต์ ตัวเลขสองหน้าจึงไม่มีวันตรงกัน ตอนนี้ถังทุกใบ
   * (โซน/ช่องทางรับเงิน/กราฟรายวัน) มาจากแถวเดียวกับยอดรวม จึงรวมกลับได้พอดีเสมอ
   *
   * ยอดค้างชำระยังมาจากตารางการจอง เพราะเป็นลูกหนี้ ไม่ใช่รายได้ — สมุดไม่ได้เก็บว่า
   * เก็บเงินครบหรือยัง
   */
  private async buildRevenue(
    scope: LedgerScope,
    kpi: DayRange,
    trend: DayRange,
    outstanding: Array<{
      id: string; reservationNo: string | null; guestFirstName: string; guestLastName: string | null;
      totalPrice: Prisma.Decimal; amountPaid: Prisma.Decimal | null; checkIn: Date; status: string;
    }>,
    todayStart: Date,
  ) {
    const [totals, byType, documents, settlements, lodgingDays, addonDays] = await Promise.all([
      this.revenue.totals({ ...scope, ...kpi }),
      this.revenue.byRevenueType({ ...scope, ...kpi }),
      this.revenue.documents({ ...scope, ...kpi }),
      this.revenue.bySettlement({ ...scope, ...kpi }),
      this.revenue.byDay({ ...scope, ...trend, revenueType: RevenueType.ROOM }),
      this.revenue.byDay({ ...scope, ...trend, revenueType: RevenueType.OTHER }),
    ]);

    // ค่าอุปกรณ์ให้เช่าลงเป็น OTHER ที่เหลือคือค่าที่พัก — หักออกจากยอดรวมแทนการบวก
    // ประเภทที่รู้จัก เผื่อวันหน้ามีชนิดรายได้ใหม่ สองก้อนนี้จะยังรวมได้เท่ายอดรวม
    const total = totals.total;
    const addon = byType.find((g) => g.key === RevenueType.OTHER)?.total ?? 0;
    const lodging = Math.max(0, Math.round(total - addon));

    // โซนไม่ได้อยู่ในสมุด — ต่อ sourceId กลับไปหาจุดกางเต็นท์ของการจองใบนั้น
    const byZone = await this.zoneBreakdown(scope.tenantId, documents);

    // ช่องทางรับเงินตามที่สมุดบันทึกไว้ ณ วันขาย (เดิมนับจาก amountPaid ซึ่งเป็นยอด
    // ที่เก็บได้ ไม่ใช่ยอดขาย — สองอย่างนี้ไม่เท่ากันเมื่อมีมัดจำหรือค้างชำระ)
    const payTotal = settlements.reduce((s, g) => s + g.total, 0) || 1;
    const byPaymentMethod = settlements
      .map((g) => ({
        method: g.key || 'UNKNOWN',
        amount: Math.round(g.total),
        pct: Math.round((g.total / payTotal) * 100),
      }))
      .filter((p) => p.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

    // Trend รายวัน (ค่าจุด vs อุปกรณ์)
    const lodgingByDay = new Map(lodgingDays.map((g) => [g.key, g.total]));
    const addonByDay = new Map(addonDays.map((g) => [g.key, g.total]));
    const dailyTrend = daysBetween(trend).map((date) => {
      const a = Math.round(addonByDay.get(date) ?? 0);
      const l = Math.round(lodgingByDay.get(date) ?? 0);
      return { date, addon: a, lodging: l, revenue: a + l };
    });

    const outstandingInvoices = outstanding
      .map((r) => ({
        id: r.id,
        reservationNo: r.reservationNo,
        guest: `${r.guestFirstName} ${r.guestLastName ?? ''}`.trim(),
        amount: Math.max(0, num(r.totalPrice) - num(r.amountPaid)),
        dueDate: r.checkIn.toISOString(),
        overdue: startOfDay(r.checkIn) < todayStart,
      }))
      .filter((r) => r.amount > 0);
    const outstandingTotal = outstandingInvoices.reduce((s, r) => s + r.amount, 0);

    return {
      total: Math.round(total),
      /** ยอดรับรู้ทางบัญชี (gross − discount) — ลานไม่แยก VAT ปกติจึงเท่ากับ total */
      netTotal: Math.round(totals.net),
      lodging,
      addon: Math.round(addon),
      outstanding: Math.round(outstandingTotal),
      byZone,
      byPaymentMethod,
      dailyTrend,
      outstandingInvoices: outstandingInvoices.slice(0, 8),
    };
  }

  /**
   * เทยอดของแต่ละใบลงถังโซน โดยต่อ `sourceId` กลับไปที่การจอง
   *
   * รับแถวที่ `tenantId` เป็น null ได้ถ้าลานเป็นของ tenant นี้ (ข้อมูลเก่าบางส่วนเป็น
   * แบบนั้น) แต่ไม่ปล่อยผ่านทั้งหมด — ไม่งั้นเป็นรูข้าม tenant
   */
  private async zoneBreakdown(
    tenantId: string,
    documents: Array<{ sourceId: string; total: number }>,
  ): Promise<Array<{ zone: string; type: string; revenue: number }>> {
    const ids = Array.from(new Set(documents.map((d) => d.sourceId)));
    if (ids.length === 0) return [];

    const rows = await this.prisma.campReservation.findMany({
      where: {
        id: { in: ids },
        OR: [{ tenantId }, { tenantId: null, campground: { tenantId } }],
      },
      select: { id: true, pitch: { select: { zone: { select: { name: true, type: true } } } } },
    });
    const zoneOf = new Map(rows.map((r) => [r.id, r.pitch?.zone ?? null]));

    const buckets = new Map<string, { zone: string; type: string; revenue: number }>();
    for (const doc of documents) {
      const zone = zoneOf.get(doc.sourceId) ?? null;
      const type = zone?.type ?? 'other';
      const name = zone?.name ?? ZONE_LABELS[type] ?? 'อื่น ๆ';
      const cur = buckets.get(type) ?? { zone: name, type, revenue: 0 };
      cur.revenue += doc.total;
      buckets.set(type, cur);
    }

    return Array.from(buckets.values())
      .map((z) => ({ ...z, revenue: Math.round(z.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  // ── Occupancy ──
  private buildOccupancy(
    res: ResWithRel[],
    totalPitches: number,
    pitches: Array<{ status: string; zone: { name: string; type: string } | null }>,
    start: Date,
    end: Date,
    trendStart: Date,
    todayStart: Date,
    /** ค่าที่พักจากสมุดรายได้ในช่วงเดียวกัน — ตัวตั้งของ ADR/RevPAS */
    lodgingRev: number,
  ) {
    const occ = res.filter((r) => OCCUPYING.includes(r.status));
    const periodDays = Math.max(1, nights(start, end));
    const denom = Math.max(1, totalPitches * periodDays);

    let occupiedNights = 0;
    let stayNightsTotal = 0;
    let stayCount = 0;
    for (const r of occ) {
      const ovn = overlapNights(r.checkIn, r.checkOut, start, end);
      occupiedNights += ovn;
      if (r.checkIn >= start && r.checkIn < end) {
        stayNightsTotal += nights(r.checkIn, r.checkOut);
        stayCount += 1;
      }
    }
    const ratePct = Math.round((occupiedNights / denom) * 100);
    const adr = occupiedNights > 0 ? Math.round(lodgingRev / occupiedNights) : 0;
    const revpas = totalPitches > 0 ? Math.round(lodgingRev / totalPitches) : 0;
    const avgLengthOfStay = stayCount > 0 ? Math.round((stayNightsTotal / stayCount) * 10) / 10 : 0;

    // Trend รายวัน (% เข้าพักต่อวัน)
    const trend = this.dailySeries(trendStart, todayStart, (key, day) => {
      const occupied = occ.filter((r) => startOfDay(r.checkIn) <= day && startOfDay(r.checkOut) > day).length;
      return { occPct: totalPitches > 0 ? Math.round((occupied / totalPitches) * 100) : 0 };
    });

    // เข้าพักตามวันในสัปดาห์ (เฉลี่ยจากช่วง trend เดียวกัน)
    const dowAcc: Record<number, { sum: number; n: number }> = {};
    for (let i = 0; i < trend.length; i++) {
      const day = addDays(trendStart, i);
      const occupied = occ.filter((r) => startOfDay(r.checkIn) <= day && startOfDay(r.checkOut) > day).length;
      const pct = totalPitches > 0 ? (occupied / totalPitches) * 100 : 0;
      const a = dowAcc[day.getDay()] ?? { sum: 0, n: 0 };
      a.sum += pct;
      a.n += 1;
      dowAcc[day.getDay()] = a;
    }
    const DOW_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const byDayOfWeek = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      day: DOW_LABELS[d],
      occPct: dowAcc[d] ? Math.round(dowAcc[d].sum / dowAcc[d].n) : 0,
    }));

    // เข้าพักรายโซน (snapshot: จุด occupied / จุดทั้งหมดในโซน)
    const zoneMap = new Map<string, { zone: string; type: string; total: number; occupied: number }>();
    for (const p of pitches) {
      const type = p.zone?.type ?? 'other';
      const name = p.zone?.name ?? ZONE_LABELS[type] ?? 'อื่น ๆ';
      const cur = zoneMap.get(type) ?? { zone: name, type, total: 0, occupied: 0 };
      cur.total += 1;
      if (p.status === 'occupied') cur.occupied += 1;
      zoneMap.set(type, cur);
    }
    const byZone = Array.from(zoneMap.values())
      .map((z) => ({ zone: z.zone, type: z.type, occPct: z.total > 0 ? Math.round((z.occupied / z.total) * 100) : 0 }))
      .sort((a, b) => b.occPct - a.occPct);

    return { ratePct, adr, revpas, avgLengthOfStay, totalPitches, occupiedNights, trend, byDayOfWeek, byZone };
  }

  // ── Bookings ──
  private buildBookings(res: ResWithRel[], start: Date, end: Date, trendStart: Date, todayStart: Date) {
    const created = res.filter((r) => r.createdAt >= start && r.createdAt < end);
    const total = created.length;
    const cancelled = created.filter((r) => r.status === 'cancelled').length;
    const cancelRatePct = total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0;

    const confirmed = created.filter((r) => r.status !== 'cancelled');
    const leadSum = confirmed.reduce((s, r) => s + nights(r.createdAt, r.checkIn), 0);
    const avgLeadTimeDays = confirmed.length > 0 ? Math.round((leadSum / confirmed.length) * 10) / 10 : 0;

    const trend = this.dailySeries(trendStart, todayStart, (key) => {
      const day = res.filter((r) => dateKey(r.createdAt) === key);
      return {
        booked: day.filter((r) => r.status !== 'cancelled').length,
        cancelled: day.filter((r) => r.status === 'cancelled').length,
      };
    });

    const statusMap = new Map<string, number>();
    for (const r of created) statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
    const byStatus = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    const recent = res.slice(0, 8).map((r) => ({
      reservationNo: r.reservationNo,
      guest: `${r.guestFirstName} ${r.guestLastName ?? ''}`.trim(),
      zone: r.pitch?.zone?.name ?? ZONE_LABELS[r.pitch?.zone?.type ?? ''] ?? '-',
      pitch: r.pitch?.code ?? '-',
      createdAt: r.createdAt.toISOString(),
      total: Math.round(num(r.totalPrice)),
      status: r.status,
    }));

    return { total, cancelled, cancelRatePct, avgLeadTimeDays, trend, byStatus, recent };
  }

  // ── Inventory ──
  private buildInventory(
    addons: Array<{
      id: string; name: string; category: string; pricePerUnit: Prisma.Decimal;
      stockQty: number; items: Array<{ qty: number }>;
    }>,
    requisitions: Array<{
      requisitionNo: string; type: string; status: string; createdAt: Date;
      items: Array<{ name: string; qty: number }>;
    }>,
  ) {
    const skuCount = addons.length;
    const enriched = addons.map((a) => {
      const borrowed = a.items.reduce((s, x) => s + x.qty, 0);
      const available = a.stockQty;
      const totalQty = available + borrowed;
      const util = totalQty > 0 ? Math.round((borrowed / totalQty) * 100) : 0;
      // จุดเตือนสต็อกต่ำ: 20% ของครอบครองทั้งหมด (อย่างน้อย 3)
      const threshold = Math.max(3, Math.round(totalQty * 0.2));
      return {
        id: a.id, name: a.name, category: a.category,
        available, borrowed, totalQty, util, threshold,
        value: Math.round(num(a.pricePerUnit) * totalQty),
        low: available <= threshold,
      };
    });

    const stockValue = enriched.reduce((s, a) => s + a.value, 0);
    const lowStockItems = enriched.filter((a) => a.low);
    const avgUtilization =
      enriched.length > 0 ? Math.round(enriched.reduce((s, a) => s + a.util, 0) / enriched.length) : 0;

    const utilization = [...enriched]
      .sort((a, b) => b.util - a.util)
      .slice(0, 8)
      .map(({ name, util, available, borrowed, totalQty }) => ({ name, util, available, borrowed, totalQty }));

    const lowStock = lowStockItems
      .sort((a, b) => a.available - b.available)
      .slice(0, 8)
      .map(({ name, available, threshold }) => ({ name, qty: available, reorder: threshold }));

    const reqStatusMap = new Map<string, number>();
    for (const r of requisitions) reqStatusMap.set(r.status, (reqStatusMap.get(r.status) ?? 0) + 1);

    const recentRequisitions = requisitions.map((r) => ({
      requisitionNo: r.requisitionNo,
      type: r.type,
      status: r.status,
      itemSummary: r.items.map((i) => `${i.name} × ${i.qty}`).join(', ') || '-',
      createdAt: r.createdAt.toISOString(),
    }));

    return {
      skuCount,
      lowStockCount: lowStockItems.length,
      stockValue,
      avgUtilization,
      utilization,
      lowStock,
      requisitions: recentRequisitions,
      requisitionStatusCounts: Array.from(reqStatusMap.entries()).map(([status, count]) => ({ status, count })),
    };
  }

  // ── Operations ──
  private buildOperations(
    res: ResWithRel[],
    pitches: Array<{ status: string }>,
    facilities: Array<{ id: string; name: string; type: string; status: string }>,
    todayStart: Date,
  ) {
    const todayKey = dateKey(todayStart);
    const notCancelled = (r: ResWithRel) => r.status !== 'cancelled' && r.status !== 'no_show';

    const checkInsToday = res.filter((r) => dateKey(r.checkIn) === todayKey && notCancelled(r)).length;
    const checkOutsToday = res.filter((r) => dateKey(r.checkOut) === todayKey && notCancelled(r)).length;

    const statusMap = new Map<string, number>();
    for (const p of pitches) statusMap.set(p.status, (statusMap.get(p.status) ?? 0) + 1);
    const pitchStatus = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    const pitchesToInspect = statusMap.get('cleaning') ?? 0;
    const maintenanceOpen =
      (statusMap.get('maintenance') ?? 0) + facilities.filter((f) => f.status === 'maintenance').length;

    const todayArrivals = res
      .filter((r) => dateKey(r.checkIn) === todayKey && notCancelled(r))
      .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())
      .slice(0, 8)
      .map((r) => ({
        reservationNo: r.reservationNo,
        guest: `${r.guestFirstName} ${r.guestLastName ?? ''}`.trim(),
        zone: r.pitch?.zone?.name ?? '-',
        pitch: r.pitch?.code ?? '-',
        numGuests: r.numGuests,
        status: r.status,
        total: Math.round(num(r.totalPrice)),
      }));

    return {
      checkInsToday,
      checkOutsToday,
      pitchesToInspect,
      maintenanceOpen,
      pitchStatus,
      todayArrivals,
      facilities: facilities.map((f) => ({ id: f.id, name: f.name, type: f.type, status: f.status })),
    };
  }

  // ── Helpers ──

  /** สร้าง series รายวันจาก start → todayStart (รวม) */
  private dailySeries<T extends object>(
    start: Date,
    todayStart: Date,
    fn: (key: string, day: Date) => T,
  ): Array<T & { date: string }> {
    const out: Array<T & { date: string }> = [];
    const days = nights(start, todayStart) + 1;
    for (let i = 0; i < days; i++) {
      const day = addDays(start, i);
      out.push({ date: dateKey(day), ...fn(dateKey(day), day) });
    }
    return out;
  }

  private normalizePeriod(p?: string): DashboardPeriod {
    return p === 'today' || p === 'week' || p === 'month' || p === 'quarter' ? p : 'week';
  }

  private emptyResponse(p?: string) {
    const period = this.normalizePeriod(p);
    return {
      period,
      range: { start: new Date().toISOString(), end: new Date().toISOString() },
      totals: { totalPitches: 0, totalReservations: 0 },
      revenue: { total: 0, netTotal: 0, lodging: 0, addon: 0, outstanding: 0, byZone: [], byPaymentMethod: [], dailyTrend: [], outstandingInvoices: [] },
      occupancy: { ratePct: 0, adr: 0, revpas: 0, avgLengthOfStay: 0, totalPitches: 0, occupiedNights: 0, trend: [], byDayOfWeek: [], byZone: [] },
      bookings: { total: 0, cancelled: 0, cancelRatePct: 0, avgLeadTimeDays: 0, trend: [], byStatus: [], recent: [] },
      inventory: { skuCount: 0, lowStockCount: 0, stockValue: 0, avgUtilization: 0, utilization: [], lowStock: [], requisitions: [], requisitionStatusCounts: [] },
      operations: { checkInsToday: 0, checkOutsToday: 0, pitchesToInspect: 0, maintenanceOpen: 0, pitchStatus: [], todayArrivals: [], facilities: [] },
    };
  }
}
