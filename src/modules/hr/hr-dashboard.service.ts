import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BANGKOK_OFFSET_MS,
  DAY_MS,
  businessDateOf,
  shiftDate,
  toBangkokDate,
} from '../../common/utils/bangkok-day.util';

// ─── Constants ────────────────────────────────────────────────────────────────

/** สถานะที่ถือว่าพ้นสภาพแล้ว — ไม่นับเป็นกำลังคน */
export const SEPARATED_STATUSES: readonly string[] = ['RESIGNED', 'TERMINATED', 'INACTIVE'];
/** เวลาเข้ากะ default เมื่อไม่มีตารางเวร (ตรงกับ HrAttendanceService.DEFAULT_START) */
export const DEFAULT_SHIFT_START = '09:00';
/** เลยเวลาเข้ากะเกินกี่นาทีจึงนับว่า "ยังไม่ลงเวลา" */
export const NO_SHOW_AFTER_MINUTES = 30;
export const TREND_DAYS = 14;
const UPCOMING_DAYS = 30;
const PROBATION_TODO_DAYS = 7;
const PENDING_PREVIEW = 6;
const OUTSTANDING_DOC_STATUSES = ['missing', 'rejected'];
/** สถานะพนักงานที่ไม่ต้องเข้างาน แม้ยังเป็นพนักงานอยู่ */
const ABSENT_STATUSES: readonly string[] = ['ON_LEAVE', 'SUSPENDED'];

// ─── Types ────────────────────────────────────────────────────────────────────

export type TodayStatus =
  | 'on_time'
  | 'late'
  | 'on_leave'
  | 'not_checked_in'
  | 'awaiting_shift'
  | 'day_off';

export interface DayCounts {
  expected: number;
  present: number;
  onTime: number;
  late: number;
  onLeave: number;
  notCheckedIn: number;
  awaitingShift: number;
  dayOff: number;
  /** present / (present + notCheckedIn) — เฉพาะคนที่ถึงเวลาเข้ากะแล้ว; null ถ้ายังไม่มีใครถึงเวลา */
  attendanceRate: number | null;
}

export interface HrDashboardOverview {
  asOf: string;
  date: string;
  propertyId: string | null;
  /**
   * พนักงานปัจจุบันที่ยังไม่ผูกสาขา (เฉพาะเมื่อกรองตามสาขา) — ไม่ถูกนับในตัวเลขอื่น
   * null เมื่อดูทั้ง tenant
   */
  unassignedEmployees: number | null;
  /** true = ใช้ตารางเวร (Roster) เป็นฐาน, false = ยังไม่มีตารางเวรวันนี้ → ใช้พนักงานทั้งหมด */
  rosterMode: boolean;
  headcount: {
    total: number;
    current: number;
    active: number;
    probation: number;
    onLongLeave: number;
    suspended: number;
    separated: number;
  };
  today: DayCounts & { lateAvgMinutes: number | null };
  departments: Array<{
    key: string;
    name: string;
    headcount: number;
    expected: number;
    present: number;
    attendanceRate: number | null;
  }>;
  pending: {
    total: number;
    leave: number;
    overtime: number;
    exceptions: number;
    items: PendingItem[];
  };
  away: Array<{
    employeeId: string;
    name: string;
    department: string;
    status: 'on_leave' | 'not_checked_in';
    leaveType: string | null;
    shiftStart: string | null;
  }>;
  trend: Array<{ date: string; expected: number; present: number; attendanceRate: number | null }>;
  upcoming: Array<{
    date: string;
    kind: 'probation' | 'interview';
    title: string;
    subtitle: string;
    overdue: boolean;
  }>;
  todos: {
    leave: number;
    overtime: number;
    exceptions: number;
    probationDue: number;
    missingDocuments: number;
  };
}

export interface PendingItem {
  id: string;
  kind: 'leave' | 'overtime' | 'exception';
  employeeId: string;
  employeeName: string;
  title: string;
  startDate: string;
  endDate: string | null;
  totalDays: number | null;
  minutes: number | null;
  /** การลาที่ต้องอนุมัติหลายขั้น — ใช้ /hr/leave/:id/approve-step แทน /approve */
  approvalStep: { current: number; required: number } | null;
  createdAt: string;
}

interface EmployeeLite {
  id: string;
  firstName: string;
  lastName: string;
  status: string | null;
  department: string | null;
  hrDepartment: { id: string; name: string } | null;
}

interface ShiftLite {
  isDayOff: boolean;
  startTime: string | null;
}

interface AttendanceLite {
  status: string;
  checkIn: Date | null;
}

// ─── Pure helpers (exported for tests) ─────────────────────────────────────────

/** Date key 'YYYY-MM-DD' of a @db.Date value (Prisma returns UTC midnight). */
export const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

/** Instant of HH:mm Bangkok time on business day `date` ('YYYY-MM-DD'). */
export const bangkokInstant = (date: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return new Date(
    Date.parse(`${date}T00:00:00.000Z`) + ((h || 0) * 60 + (m || 0)) * 60_000 - BANGKOK_OFFSET_MS,
  );
};

export const isSeparated = (status: string | null | undefined): boolean =>
  SEPARATED_STATUSES.includes((status ?? '').toUpperCase());

export const rate = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 100) : null;

export function classifyEmployeeDay(input: {
  attendance: AttendanceLite | null;
  onLeave: boolean;
  shift: ShiftLite | null;
  rosterMode: boolean;
  date: string;
  now: Date;
}): TodayStatus {
  const att = input.attendance;
  if (att && (att.status === 'present' || att.status === 'late')) {
    return att.status === 'late' ? 'late' : 'on_time';
  }
  if (input.onLeave) return 'on_leave';

  const scheduled = input.rosterMode ? !!input.shift && !input.shift.isDayOff : true;
  if (!scheduled) return 'day_off';

  const start = input.shift?.startTime ?? DEFAULT_SHIFT_START;
  const cutoff = bangkokInstant(input.date, start).getTime() + NO_SHOW_AFTER_MINUTES * 60_000;
  return input.now.getTime() >= cutoff ? 'not_checked_in' : 'awaiting_shift';
}

export function summarize(statuses: TodayStatus[]): DayCounts {
  const c: DayCounts = {
    expected: 0,
    present: 0,
    onTime: 0,
    late: 0,
    onLeave: 0,
    notCheckedIn: 0,
    awaitingShift: 0,
    dayOff: 0,
    attendanceRate: null,
  };
  for (const s of statuses) {
    if (s === 'on_time') c.onTime += 1;
    else if (s === 'late') c.late += 1;
    else if (s === 'on_leave') c.onLeave += 1;
    else if (s === 'not_checked_in') c.notCheckedIn += 1;
    else if (s === 'awaiting_shift') c.awaitingShift += 1;
    else c.dayOff += 1;
  }
  c.present = c.onTime + c.late;
  c.expected = c.present + c.notCheckedIn + c.awaitingShift;
  c.attendanceRate = rate(c.present, c.present + c.notCheckedIn);
  return { ...c };
}

const fullName = (e: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
  [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim() || '—';

const deptOf = (e: EmployeeLite): { key: string; name: string } => {
  if (e.hrDepartment) return { key: e.hrDepartment.id, name: e.hrDepartment.name };
  if (e.department) return { key: `txt:${e.department}`, name: e.department };
  return { key: 'none', name: 'ไม่ระบุแผนก' };
};

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * HR Dashboard — สรุปข้อมูลกำลังคน/การเข้างาน/งานค้างของวันนี้ตามเวลาไทย
 *
 * หลักการ:
 *  - "วันนี้" ตัดที่เที่ยงคืนกรุงเทพฯ และเทียบกับคอลัมน์ @db.Date เป็น UTC midnight
 *    (เหมือน HrAttendanceService.checkIn) — ไม่ใช้ setHours() ที่ขึ้นกับ TZ ของ server
 *  - นับเฉพาะพนักงานที่ยังไม่พ้นสภาพ (ไม่ใช่ RESIGNED/TERMINATED/INACTIVE)
 *  - ฐานของอัตราเข้างาน = คนที่มีกะและถึงเวลาเข้ากะแล้ว (ไม่ใช่พนักงานทั้งหมด)
 *  - กรองสาขา: นับเฉพาะพนักงานที่ผูกกับสาขานั้น — คนที่ยังไม่ผูกสาขาจะไม่ถูกนับ
 *    แต่แจ้งจำนวนไว้ใน `unassignedEmployees` ให้ HR ไปผูกสาขาให้ครบ
 */
@Injectable()
export class HrDashboardService {
  private readonly logger = new Logger(HrDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(
    tenantId: string | undefined,
    propertyId?: string,
    now: Date = new Date(),
  ): Promise<HrDashboardOverview> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const today = toBangkokDate(now);
    const todayDate = businessDateOf(today);
    const trendStart = shiftDate(today, -(TREND_DAYS - 1));
    const trendStartDate = businessDateOf(trendStart);
    const days = Array.from({ length: TREND_DAYS }, (_, i) => shiftDate(trendStart, i));

    const employees: EmployeeLite[] = await this.prisma.employee.findMany({
      where: {
        tenantId,
        anonymizedAt: null,
        ...(propertyId ? { propertyId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        department: true,
        hrDepartment: { select: { id: true, name: true } },
      },
    });

    const current = employees.filter((e) => !isSeparated(e.status));
    const ids = current.map((e) => e.id);
    const byId = new Map(current.map((e) => [e.id, e]));
    const inIds = { in: ids };

    const employeeSelect = { select: { id: true, firstName: true, lastName: true } };
    const probationHorizon = businessDateOf(shiftDate(today, UPCOMING_DAYS));

    const [
      attendances,
      shifts,
      leaves,
      pendingLeave,
      pendingLeaveCount,
      pendingOt,
      pendingOtCount,
      pendingEx,
      pendingExCount,
      probations,
      missingDocuments,
      interviews,
      unassignedEmployees,
    ] = await Promise.all([
      this.prisma.hrAttendance.findMany({
        where: { tenantId, employeeId: inIds, date: { gte: trendStartDate, lte: todayDate } },
        select: { employeeId: true, date: true, status: true, checkIn: true },
      }),
      this.prisma.hrShiftAssignment.findMany({
        where: {
          tenantId,
          employeeId: inIds,
          date: { gte: trendStartDate, lte: todayDate },
          status: { not: 'cancelled' },
        },
        select: {
          employeeId: true,
          date: true,
          isDayOff: true,
          startTime: true,
          shiftType: { select: { startTime: true } },
        },
      }),
      this.prisma.hrLeaveRequest.findMany({
        where: {
          tenantId,
          employeeId: inIds,
          status: 'approved',
          startDate: { lte: todayDate },
          endDate: { gte: trendStartDate },
        },
        select: {
          employeeId: true,
          startDate: true,
          endDate: true,
          leaveType: { select: { name: true } },
        },
      }),
      this.prisma.hrLeaveRequest.findMany({
        where: { tenantId, employeeId: inIds, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: PENDING_PREVIEW,
        include: { employee: employeeSelect, leaveType: { select: { name: true } } },
      }),
      this.prisma.hrLeaveRequest.count({
        where: { tenantId, employeeId: inIds, status: 'pending' },
      }),
      this.prisma.hrOvertimeRequest.findMany({
        where: { tenantId, employeeId: inIds, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: PENDING_PREVIEW,
        include: { employee: employeeSelect },
      }),
      this.prisma.hrOvertimeRequest.count({
        where: { tenantId, employeeId: inIds, status: 'pending' },
      }),
      this.prisma.hrAttendanceException.findMany({
        where: { tenantId, employeeId: inIds, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: PENDING_PREVIEW,
        include: { employee: employeeSelect },
      }),
      this.prisma.hrAttendanceException.count({
        where: { tenantId, employeeId: inIds, status: 'pending' },
      }),
      this.prisma.hrProbationRound.findMany({
        where: {
          tenantId,
          employeeId: inIds,
          status: { in: ['active', 'extended'] },
          dueDate: { lte: probationHorizon },
        },
        orderBy: { dueDate: 'asc' },
        include: { employee: employeeSelect },
      }),
      this.prisma.hrEmployeeDocumentRequirement.count({
        where: { tenantId, employeeId: inIds, status: { in: OUTSTANDING_DOC_STATUSES } },
      }),
      this.prisma.hrInterview.findMany({
        where: {
          tenantId,
          status: { in: ['scheduled', 'rescheduled'] },
          scheduledAt: { gte: now, lt: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
        include: { candidate: { select: { firstName: true, lastName: true } } },
      }),
      propertyId
        ? this.prisma.employee.count({
            where: {
              tenantId,
              anonymizedAt: null,
              propertyId: null,
              status: { notIn: [...SEPARATED_STATUSES] },
            },
          })
        : Promise.resolve(null),
    ]);

    // ── Index raw rows by day ──────────────────────────────────────────────────
    const attIdx = new Map<string, AttendanceLite>();
    for (const a of attendances) {
      attIdx.set(`${dateKey(a.date)}|${a.employeeId}`, { status: a.status, checkIn: a.checkIn });
    }
    const shiftIdx = new Map<string, ShiftLite>();
    const rosterDays = new Set<string>();
    for (const s of shifts) {
      const d = dateKey(s.date);
      rosterDays.add(d);
      shiftIdx.set(`${d}|${s.employeeId}`, {
        isDayOff: s.isDayOff,
        startTime: s.startTime ?? s.shiftType?.startTime ?? null,
      });
    }
    const leaveIdx = new Map<string, string>(); // `${day}|${emp}` → leave type name
    for (const l of leaves) {
      const from = dateKey(l.startDate) < trendStart ? trendStart : dateKey(l.startDate);
      const to = dateKey(l.endDate) > today ? today : dateKey(l.endDate);
      for (let d = from; d <= to; d = shiftDate(d, 1)) {
        leaveIdx.set(`${d}|${l.employeeId}`, l.leaveType?.name ?? 'ลา');
      }
    }

    // พนักงานที่สถานะเป็นลายาว/พักงาน ไม่นับเป็นคนที่ต้องเข้างาน
    const absentByStatus = new Set(
      current
        .filter((e) => ABSENT_STATUSES.includes((e.status ?? '').toUpperCase()))
        .map((e) => e.id),
    );

    const classifyDay = (day: string) => {
      const rosterMode = rosterDays.has(day);
      const statuses = new Map<string, TodayStatus>();
      for (const id of ids) {
        statuses.set(
          id,
          classifyEmployeeDay({
            attendance: attIdx.get(`${day}|${id}`) ?? null,
            onLeave: leaveIdx.has(`${day}|${id}`) || absentByStatus.has(id),
            shift: shiftIdx.get(`${day}|${id}`) ?? null,
            rosterMode,
            date: day,
            now,
          }),
        );
      }
      return { rosterMode, statuses };
    };

    // ── Trend ──────────────────────────────────────────────────────────────────
    const todayResult = classifyDay(today);
    const trend = days.map((day) => {
      const r = day === today ? todayResult : classifyDay(day);
      const c = summarize([...r.statuses.values()]);
      return {
        date: day,
        expected: c.expected,
        present: c.present,
        attendanceRate: c.attendanceRate,
      };
    });

    // ── Today ──────────────────────────────────────────────────────────────────
    const todayCounts = summarize([...todayResult.statuses.values()]);
    const lateMinutes: number[] = [];
    for (const [id, st] of todayResult.statuses) {
      if (st !== 'late') continue;
      const checkIn = attIdx.get(`${today}|${id}`)?.checkIn;
      if (!checkIn) continue;
      const start = shiftIdx.get(`${today}|${id}`)?.startTime ?? DEFAULT_SHIFT_START;
      lateMinutes.push(
        Math.max(0, (checkIn.getTime() - bangkokInstant(today, start).getTime()) / 60_000),
      );
    }
    const lateAvgMinutes = lateMinutes.length
      ? Math.round(lateMinutes.reduce((a, b) => a + b, 0) / lateMinutes.length)
      : null;

    // ── Departments ────────────────────────────────────────────────────────────
    const deptMap = new Map<
      string,
      { key: string; name: string; headcount: number; statuses: TodayStatus[] }
    >();
    for (const e of current) {
      const d = deptOf(e);
      const row = deptMap.get(d.key) ?? { ...d, headcount: 0, statuses: [] };
      deptMap.set(d.key, {
        ...row,
        headcount: row.headcount + 1,
        statuses: [...row.statuses, todayResult.statuses.get(e.id) ?? 'day_off'],
      });
    }
    const departments = [...deptMap.values()]
      .map((d) => {
        const c = summarize(d.statuses);
        return {
          key: d.key,
          name: d.name,
          headcount: d.headcount,
          expected: c.expected,
          present: c.present,
          attendanceRate: c.attendanceRate,
        };
      })
      .sort((a, b) => b.headcount - a.headcount || a.name.localeCompare(b.name, 'th'));

    // ── Away today ─────────────────────────────────────────────────────────────
    const away: HrDashboardOverview['away'] = [];
    for (const [id, st] of todayResult.statuses) {
      if (st !== 'on_leave' && st !== 'not_checked_in') continue;
      const e = byId.get(id);
      if (!e) continue;
      away.push({
        employeeId: id,
        name: fullName(e),
        department: deptOf(e).name,
        status: st,
        leaveType: st === 'on_leave' ? (leaveIdx.get(`${today}|${id}`) ?? null) : null,
        shiftStart:
          st === 'not_checked_in'
            ? (shiftIdx.get(`${today}|${id}`)?.startTime ?? DEFAULT_SHIFT_START)
            : null,
      });
    }
    away.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name, 'th'));

    // ── Pending approvals ──────────────────────────────────────────────────────
    const items: PendingItem[] = [
      ...pendingLeave.map((l) => ({
        id: l.id,
        kind: 'leave' as const,
        employeeId: l.employeeId,
        employeeName: fullName(l.employee),
        title: l.leaveType?.name ?? 'การลา',
        startDate: dateKey(l.startDate),
        endDate: dateKey(l.endDate),
        totalDays: l.totalDays,
        minutes: null,
        approvalStep:
          (l.requiredLevels ?? 1) > 1
            ? { current: l.currentLevel, required: l.requiredLevels }
            : null,
        createdAt: l.createdAt.toISOString(),
      })),
      ...pendingOt.map((o) => ({
        id: o.id,
        kind: 'overtime' as const,
        employeeId: o.employeeId,
        employeeName: fullName(o.employee),
        title: 'OT',
        startDate: dateKey(o.date),
        endDate: null,
        totalDays: null,
        minutes: o.minutes,
        approvalStep: null,
        createdAt: o.createdAt.toISOString(),
      })),
      ...pendingEx.map((x) => ({
        id: x.id,
        kind: 'exception' as const,
        employeeId: x.employeeId,
        employeeName: fullName(x.employee),
        title: x.type,
        startDate: dateKey(x.date),
        endDate: null,
        totalDays: null,
        minutes: null,
        approvalStep: null,
        createdAt: x.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, PENDING_PREVIEW);

    // ── Upcoming ───────────────────────────────────────────────────────────────
    const upcoming: HrDashboardOverview['upcoming'] = [
      ...probations.map((p) => ({
        date: dateKey(p.dueDate),
        kind: 'probation' as const,
        title: `${fullName(p.employee)} ครบทดลองงาน`,
        subtitle: p.status === 'extended' ? 'รอบขยายเวลา · ต้องประเมินผล' : 'ต้องประเมินผลทดลองงาน',
        overdue: dateKey(p.dueDate) < today,
      })),
      ...interviews.map((i) => ({
        date: toBangkokDate(i.scheduledAt),
        kind: 'interview' as const,
        title: `สัมภาษณ์ ${fullName(i.candidate)}`,
        subtitle: `รอบที่ ${i.round}${i.location ? ` · ${i.location}` : ''}`,
        overdue: false,
      })),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 6);

    const probationCutoff = shiftDate(today, PROBATION_TODO_DAYS);
    const probationDue = probations.filter((p) => dateKey(p.dueDate) <= probationCutoff).length;

    // ── Headcount ──────────────────────────────────────────────────────────────
    const countStatus = (s: string) =>
      current.filter((e) => (e.status ?? 'ACTIVE').toUpperCase() === s).length;

    return {
      asOf: now.toISOString(),
      date: today,
      propertyId: propertyId ?? null,
      unassignedEmployees,
      rosterMode: todayResult.rosterMode,
      headcount: {
        total: employees.length,
        current: current.length,
        active: countStatus('ACTIVE'),
        probation: countStatus('PROBATION'),
        onLongLeave: countStatus('ON_LEAVE'),
        suspended: countStatus('SUSPENDED'),
        separated: employees.length - current.length,
      },
      today: { ...todayCounts, lateAvgMinutes },
      departments,
      pending: {
        total: pendingLeaveCount + pendingOtCount + pendingExCount,
        leave: pendingLeaveCount,
        overtime: pendingOtCount,
        exceptions: pendingExCount,
        items,
      },
      away,
      trend,
      upcoming,
      todos: {
        leave: pendingLeaveCount,
        overtime: pendingOtCount,
        exceptions: pendingExCount,
        probationDue,
        missingDocuments,
      },
    };
  }
}
