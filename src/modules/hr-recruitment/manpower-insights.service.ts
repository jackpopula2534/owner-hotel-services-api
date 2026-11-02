import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const BKK_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** พนักงานที่ยังทำงานอยู่ (นับเป็นอัตรากำลังจริง) */
const ON_PAYROLL_STATUSES = ['ACTIVE', 'PROBATION'];
/** พ้นสภาพ — ค่าที่ hr-offboarding/hr-probation เขียนจริง (RESIGNED/TERMINATED) + INACTIVE */
const SEPARATED_STATUSES = ['RESIGNED', 'TERMINATED', 'INACTIVE'];
const RECRUITING_STATUSES = ['recruiting', 'interviewing', 'offer_made'];
const NOT_ACTIVE_STATUSES = ['completed', 'cancelled', 'rejected'];

export interface ManpowerSummary {
  pendingApproval: number;
  budgetPending: number;
  recruiting: number;
  startingThisMonth: number;
  avgTimeToHireDays: number | null;
  active: number;
  closed: number;
}

export interface DepartmentInsight {
  id: string;
  name: string;
  activeHeadcount: number;
  plannedHeadcount: number | null;
  overtimeHoursThisMonth: number;
  annualPersonnelBudget: number | null;
  committedBudgetThisYear: number;
  remainingBudget: number | null;
}

export interface ManpowerInsights {
  avgTimeToHireDays: number | null;
  sampleSize: number;
  department: DepartmentInsight | null;
  positionSalary: { min: number; max: number; count: number } | null;
  recentLeavers: Array<{ id: string; name: string; positionName: string | null; status: string; leftAt: string }>;
}

export interface ProbationProgressRow {
  employeeId: string;
  name: string;
  round: null | {
    id: string;
    status: string;
    startDate: Date;
    dueDate: Date;
    checkpoints: Array<{
      id: string;
      label: string;
      dueDate: Date;
      status: string;
      score: number | null;
      reviewedAt: Date | null;
    }>;
  };
}

/** ปฏิทินไทย: ปี/เดือนปัจจุบันตามเวลา Asia/Bangkok */
function bangkokYearMonth(now: Date): { year: number; month: number } {
  const shifted = new Date(now.getTime() + BKK_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** ขอบเดือนแบบ instant (เวลาไทย) — ใช้กับคอลัมน์ DateTime ปกติ */
export function bangkokMonthRange(now: Date): { start: Date; end: Date } {
  const { year, month } = bangkokYearMonth(now);
  return {
    start: new Date(Date.UTC(year, month, 1) - BKK_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - BKK_OFFSET_MS),
  };
}

/** ขอบเดือนแบบ UTC midnight — ใช้กับคอลัมน์ @db.Date */
export function dateColumnMonthRange(now: Date): { start: Date; end: Date } {
  const { year, month } = bangkokYearMonth(now);
  return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
}

function bangkokYearRange(now: Date): { start: Date; end: Date } {
  const { year } = bangkokYearMonth(now);
  return {
    start: new Date(Date.UTC(year, 0, 1) - BKK_OFFSET_MS),
    end: new Date(Date.UTC(year + 1, 0, 1) - BKK_OFFSET_MS),
  };
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * ตัวเลขประกอบการตัดสินใจของหน้า "ขอกำลังพล": สรุปภาพรวม, ข้อมูลแผนก/ตำแหน่ง
 * ระหว่างกรอกคำขอ และความคืบหน้าทดลองงานของคนที่จ้างจากคำขอ
 */
@Injectable()
export class ManpowerInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  async summary(tenantId: string, now: Date = new Date()): Promise<ManpowerSummary> {
    const month = bangkokMonthRange(now);
    const [grouped, startingThisMonth, timeToHire] = await Promise.all([
      this.db.hrManpowerRequest.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.db.hrHireRecord.count({
        where: {
          tenantId,
          startDate: { gte: month.start, lt: month.end },
          candidate: { status: 'hired' },
        },
      }),
      this.timeToHire(tenantId, {}),
    ]);

    const byStatus = new Map<string, number>(
      (grouped ?? []).map((g: { status: string; _count: { _all: number } }) => [g.status, g._count._all]),
    );
    const sum = (statuses: string[]) => statuses.reduce((acc, st) => acc + (byStatus.get(st) ?? 0), 0);
    const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
    const closed = sum(NOT_ACTIVE_STATUSES);

    return {
      pendingApproval: sum(['pending_approval']),
      budgetPending: sum(['budget_pending']),
      recruiting: sum(RECRUITING_STATUSES),
      startingThisMonth,
      avgTimeToHireDays: timeToHire.avgDays,
      active: total - closed,
      closed,
    };
  }

  /**
   * เฉลี่ยวันจากสร้างคำขอ → hire record แรกของคำขอ (นับเฉพาะคำขอที่มี hire ≥ 1)
   */
  private async timeToHire(
    tenantId: string,
    requestFilter: { departmentId?: string; positionId?: string },
  ): Promise<{ avgDays: number | null; sampleSize: number }> {
    const hires: Array<{ createdAt: Date; candidate: { manpowerRequestId: string; manpowerRequest: { createdAt: Date } } }> =
      await this.db.hrHireRecord.findMany({
        where: {
          tenantId,
          ...(Object.keys(requestFilter).length && { candidate: { manpowerRequest: requestFilter } }),
        },
        select: {
          createdAt: true,
          candidate: { select: { manpowerRequestId: true, manpowerRequest: { select: { createdAt: true } } } },
        },
      });

    const firstHire = new Map<string, { requestCreated: Date; hiredAt: Date }>();
    for (const h of hires ?? []) {
      const reqId = h.candidate?.manpowerRequestId;
      const requestCreated = h.candidate?.manpowerRequest?.createdAt;
      if (!reqId || !requestCreated) continue;
      const prev = firstHire.get(reqId);
      if (!prev || new Date(h.createdAt) < prev.hiredAt) {
        firstHire.set(reqId, { requestCreated: new Date(requestCreated), hiredAt: new Date(h.createdAt) });
      }
    }
    if (!firstHire.size) return { avgDays: null, sampleSize: 0 };
    const totalDays = [...firstHire.values()].reduce(
      (acc, v) => acc + Math.max(0, v.hiredAt.getTime() - v.requestCreated.getTime()) / DAY_MS,
      0,
    );
    return { avgDays: Math.round((totalDays / firstHire.size) * 10) / 10, sampleSize: firstHire.size };
  }

  async insights(
    tenantId: string,
    params: { departmentId?: string; positionId?: string },
    now: Date = new Date(),
  ): Promise<ManpowerInsights> {
    const { departmentId, positionId } = params;
    const filter = positionId ? { positionId } : departmentId ? { departmentId } : {};

    const [timeToHire, department, positionSalary, recentLeavers] = await Promise.all([
      this.timeToHire(tenantId, filter),
      departmentId ? this.departmentInsight(tenantId, departmentId, now) : null,
      positionId ? this.positionSalary(tenantId, positionId) : null,
      departmentId ? this.recentLeavers(tenantId, departmentId, now) : [],
    ]);

    return {
      avgTimeToHireDays: timeToHire.avgDays,
      sampleSize: timeToHire.sampleSize,
      department,
      positionSalary,
      recentLeavers,
    };
  }

  private async departmentInsight(tenantId: string, departmentId: string, now: Date): Promise<DepartmentInsight | null> {
    const dept = await this.db.hrDepartment.findFirst({
      where: { id: departmentId, tenantId },
      select: { id: true, name: true, plannedHeadcount: true, annualPersonnelBudget: true },
    });
    if (!dept) return null;

    const otMonth = dateColumnMonthRange(now); // hr_overtime_requests.date เป็น @db.Date
    const year = bangkokYearRange(now);
    const [activeHeadcount, overtime, committed] = await Promise.all([
      this.db.employee.count({ where: { tenantId, departmentId, status: { in: ON_PAYROLL_STATUSES } } }),
      this.db.hrOvertimeRequest.aggregate({
        where: {
          tenantId,
          status: 'approved',
          date: { gte: otMonth.start, lt: otMonth.end },
          employee: { departmentId },
        },
        _sum: { minutes: true },
      }),
      this.db.hrManpowerRequest.aggregate({
        where: {
          tenantId,
          departmentId,
          budgetApprovedAt: { gte: year.start, lt: year.end },
          status: { not: 'cancelled' },
        },
        _sum: { budgetTotal: true },
      }),
    ]);

    const annualPersonnelBudget = toNumberOrNull(dept.annualPersonnelBudget);
    const committedBudgetThisYear = Number(committed?._sum?.budgetTotal ?? 0);
    const minutes = Number(overtime?._sum?.minutes ?? 0);
    return {
      id: dept.id,
      name: dept.name,
      activeHeadcount,
      plannedHeadcount: dept.plannedHeadcount ?? null,
      overtimeHoursThisMonth: Math.round((minutes / 60) * 10) / 10,
      annualPersonnelBudget,
      committedBudgetThisYear,
      remainingBudget: annualPersonnelBudget === null ? null : annualPersonnelBudget - committedBudgetThisYear,
    };
  }

  private async positionSalary(tenantId: string, positionId: string): Promise<ManpowerInsights['positionSalary']> {
    const agg = await this.db.employee.aggregate({
      where: { tenantId, positionId, status: { in: ON_PAYROLL_STATUSES }, baseSalary: { not: null } },
      _min: { baseSalary: true },
      _max: { baseSalary: true },
      _count: { baseSalary: true },
    });
    const count = Number(agg?._count?.baseSalary ?? 0);
    if (!count) return null;
    return { min: Number(agg._min.baseSalary), max: Number(agg._max.baseSalary), count };
  }

  private async recentLeavers(tenantId: string, departmentId: string, now: Date): Promise<ManpowerInsights['recentLeavers']> {
    const since = new Date(now.getTime() - 90 * DAY_MS);
    const rows: Array<{
      id: string;
      firstName: string;
      lastName: string;
      status: string;
      updatedAt: Date;
      position: string | null;
      hrPosition: { name: string } | null;
    }> = await this.db.employee.findMany({
      where: { tenantId, departmentId, status: { in: SEPARATED_STATUSES }, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        updatedAt: true,
        position: true,
        hrPosition: { select: { name: true } },
      },
    });
    return (rows ?? []).map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      positionName: e.hrPosition?.name ?? e.position ?? null,
      status: e.status,
      leftAt: new Date(e.updatedAt).toISOString(),
    }));
  }

  /** ความคืบหน้าทดลองงานของทุกคนที่จ้างจากคำขอนี้ (รอบล่าสุดต่อคน) */
  async probation(requestId: string, tenantId: string): Promise<ProbationProgressRow[]> {
    const request = await this.db.hrManpowerRequest.findFirst({
      where: { id: requestId, tenantId },
      select: { id: true },
    });
    if (!request) throw new NotFoundException(`Manpower request ${requestId} not found`);

    const hired: Array<{ hireRecord: { employee: { id: string; firstName: string; lastName: string } | null } | null }> =
      await this.db.hrCandidate.findMany({
        where: { tenantId, manpowerRequestId: requestId, status: 'hired' },
        orderBy: { updatedAt: 'asc' },
        select: {
          hireRecord: { select: { employee: { select: { id: true, firstName: true, lastName: true } } } },
        },
      });
    const employees = (hired ?? [])
      .map((c) => c.hireRecord?.employee)
      .filter((e): e is { id: string; firstName: string; lastName: string } => !!e);
    if (!employees.length) return [];

    const rounds: Array<Record<string, any>> = await this.db.hrProbationRound.findMany({
      where: { tenantId, employeeId: { in: employees.map((e) => e.id) } },
      orderBy: { createdAt: 'desc' },
      include: { checkpoints: { orderBy: { dueDate: 'asc' } } },
    });
    const latest = new Map<string, Record<string, any>>();
    for (const r of rounds ?? []) if (!latest.has(r.employeeId)) latest.set(r.employeeId, r);

    return employees.map((e) => {
      const r = latest.get(e.id);
      return {
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        round: r
          ? {
              id: r.id,
              status: r.status,
              startDate: r.startDate,
              dueDate: r.dueDate,
              checkpoints: (r.checkpoints ?? []).map((cp: Record<string, any>) => ({
                id: cp.id,
                label: cp.label,
                dueDate: cp.dueDate,
                status: cp.status,
                score: toNumberOrNull(cp.score),
                reviewedAt: cp.reviewedAt ?? null,
              })),
            }
          : null,
      };
    });
  }
}
