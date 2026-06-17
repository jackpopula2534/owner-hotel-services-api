import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import {
  AuditAction,
  AuditResource,
  AuditCategory,
} from '../../audit-log/dto/audit-log.dto';
import { HrPayrollPolicyService } from './hr-payroll-policy.service';
import { RunPayrollDto, ApprovePayrollDto, UpdatePayrollDto } from './dto/run-payroll.dto';

interface PayrollItemInput {
  type: string;
  name: string;
  amount: number;
  note?: string;
}

@Injectable()
export class HrPayrollService {
  private readonly logger = new Logger(HrPayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: HrPayrollPolicyService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Normalize a date to a YYYY-MM-DD key for matching OT requests to attendance. */
  private dateKey(value: string | Date): string {
    return new Date(value).toISOString().slice(0, 10);
  }

  // ─── List & Detail ────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const { status, search } = query;
    const month = query.month ? parseInt(query.month, 10) : undefined;
    const year = query.year ? parseInt(query.year, 10) : undefined;

    const where: Record<string, unknown> = { tenantId };
    if (status) where['status'] = status;
    if (month) where['month'] = month;
    if (year) where['year'] = year;
    if (search) {
      where['employee'] = {
        OR: [
          { firstName: { contains: search } },
          { lastName: { contains: search } },
          { employeeCode: { contains: search } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).hrPayroll.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: true,
            },
          },
          items: true,
        },
      }),
      (this.prisma as any).hrPayroll.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const payroll = await (this.prisma as any).hrPayroll.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            position: true,
            bankAccount: true,
            propertyId: true,
          },
        },
        items: { orderBy: { type: 'asc' } },
      },
    });
    if (!payroll) throw new NotFoundException(`Payroll record ${id} not found`);
    return payroll;
  }

  // ─── Manual edit (per-employee, draft only) ───────────────────────────────────

  /**
   * แก้ไขเงินเดือน "ร่าง" รายคนด้วยมือ — เจ้าของ/HR ปรับฐานเงินเดือนและรายการย่อย
   * (เบี้ยเลี้ยง/หัก/OT/โบนัส) ได้ จากนั้นคำนวณยอดรวมทุกคอลัมน์ + ยอดสุทธิใหม่จาก
   * รายการที่ส่งมา เพื่อให้ตัวเลขที่แสดงตรงกับ breakdown เสมอ แก้ได้เฉพาะสถานะ draft
   */
  async updateDraft(
    id: string,
    dto: UpdatePayrollDto,
    tenantId: string,
    userId?: string,
  ) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status !== 'draft') {
      throw new BadRequestException(
        'แก้ไขได้เฉพาะเงินเดือนสถานะ "ร่าง" เท่านั้น (อนุมัติ/จ่ายแล้วต้องยกเลิกก่อน)',
      );
    }

    const baseSalary =
      dto.baseSalary !== undefined ? Number(dto.baseSalary) : Number(payroll.baseSalary);

    // ถ้าไม่ส่ง items มา = คงรายการเดิม (เช่น แก้แค่ฐานเงินเดือน)
    const items: PayrollItemInput[] = (dto.items ?? payroll.items ?? []).map((i: any) => ({
      type: i.type,
      name: i.name,
      amount: Number(i.amount),
      note: i.note ?? undefined,
    }));

    const sumType = (type: string) =>
      items.filter((i) => i.type === type).reduce((s, i) => s + i.amount, 0);

    const overtimePay = sumType('overtime');
    const totalAllowance = sumType('allowance');
    const bonusPay = sumType('bonus');
    const totalDeduction = sumType('deduction');
    const netSalary = baseSalary + overtimePay + totalAllowance + bonusPay - totalDeduction;

    const updated = await (this.prisma as any).hrPayroll.update({
      where: { id },
      data: {
        baseSalary: baseSalary.toFixed(2),
        overtimePay: overtimePay.toFixed(2),
        totalAllowance: totalAllowance.toFixed(2),
        bonusPay: bonusPay.toFixed(2),
        totalDeduction: totalDeduction.toFixed(2),
        netSalary: netSalary.toFixed(2),
        ...(dto.note !== undefined && { note: dto.note }),
        items: {
          deleteMany: {},
          create: items.map((i) => ({
            type: i.type,
            name: i.name,
            amount: i.amount.toFixed(2),
            note: i.note ?? null,
          })),
        },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true },
        },
        items: { orderBy: { type: 'asc' } },
      },
    });

    await this.auditLog
      .log({
        action: AuditAction.PAYROLL_UPDATE,
        resource: AuditResource.PAYROLL,
        resourceId: id,
        category: AuditCategory.HR,
        tenantId,
        userId,
        oldValues: {
          baseSalary: payroll.baseSalary,
          netSalary: payroll.netSalary,
        },
        newValues: { baseSalary, netSalary },
        description: `Payroll edited (draft) for employee ${payroll.employee?.employeeCode ?? payroll.employeeId}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(`Payroll ${id} edited manually by ${userId ?? 'system'}`);
    return updated;
  }

  // ─── Run Payroll (policy-driven engine, P1-07) ─────────────────────────────────

  /**
   * Bulk-generate payroll records for a month/year. Each employee's payroll is
   * computed from the effective payroll policy + attendance + approved OT +
   * unpaid leave, instead of a fixed formula.
   */
  async runPayroll(dto: RunPayrollDto, tenantId: string, userId?: string) {
    const { month, year, employeeIds, items } = dto;

    const employeeWhere: Record<string, unknown> = { tenantId, status: 'ACTIVE' };
    if (employeeIds?.length) employeeWhere['id'] = { in: employeeIds };

    const employees = await (this.prisma.employee as any).findMany({ where: employeeWhere });
    if (!employees.length) throw new BadRequestException('No active employees found');

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    monthEnd.setUTCHours(23, 59, 59, 999);

    const results: any[] = [];
    const errors: string[] = [];

    for (const emp of employees) {
      try {
        const existing = await (this.prisma as any).hrPayroll.findFirst({
          where: { tenantId, employeeId: emp.id, month, year },
        });
        if (existing) {
          errors.push(
            `Payroll already exists for employee ${emp.employeeCode ?? emp.id} (${month}/${year})`,
          );
          continue;
        }

        const policy = await this.policyService.resolveEffective(tenantId, emp.propertyId);
        const breakdown = await this.computeForEmployee(
          emp,
          policy,
          { monthStart, monthEnd },
          tenantId,
          items ?? [],
        );

        const payroll = await (this.prisma as any).hrPayroll.create({
          data: {
            tenantId,
            employeeId: emp.id,
            month,
            year,
            policyId: policy.id ?? null,
            periodStart: monthStart,
            periodEnd: new Date(Date.UTC(year, month, 0)),
            baseSalary: breakdown.baseSalary.toFixed(2),
            totalAllowance: breakdown.totalAllowance.toFixed(2),
            totalDeduction: breakdown.totalDeduction.toFixed(2),
            overtimePay: breakdown.overtimePay.toFixed(2),
            bonusPay: breakdown.bonusPay.toFixed(2),
            netSalary: breakdown.netSalary.toFixed(2),
            status: 'draft',
            items: { create: breakdown.items.map((i) => ({
              type: i.type,
              name: i.name,
              amount: i.amount.toFixed(2),
              note: i.note ?? null,
            })) },
          },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
            items: true,
          },
        });

        results.push(payroll);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to run payroll for employee ${emp.id}: ${msg}`);
        errors.push(`Employee ${emp.employeeCode ?? emp.id}: ${msg}`);
      }
    }

    await this.auditLog
      .log({
        action: AuditAction.PAYROLL_RUN,
        resource: AuditResource.PAYROLL,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues: { month, year, created: results.length, errors: errors.length },
        description: `Payroll run for ${month}/${year}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(`Payroll run complete: ${results.length} created, ${errors.length} errors`);
    return { created: results.length, errors, data: results };
  }

  /**
   * Pure-ish calculation of one employee's payroll. Exposed (non-private) so it
   * can be unit-tested directly.
   */
  async computeForEmployee(
    emp: any,
    policy: any,
    period: { monthStart: Date; monthEnd: Date },
    tenantId: string,
    extraItems: PayrollItemInput[],
  ) {
    const baseSalary = Number(emp.baseSalary ?? 0);
    const dailyRate = baseSalary / (policy.workingDaysPerMonth || 30);
    const hourlyRate = dailyRate / (policy.workingHoursPerDay || 8);

    const items: PayrollItemInput[] = [];

    // ── Roster + holiday context ───────────────────────────────────────────
    // ใช้ร่วมกันสำหรับ OT วันหยุด (holidayOtMultiplier), หักขาดงาน และมาสาย
    const assignments = await (this.prisma as any).hrShiftAssignment.findMany({
      where: {
        tenantId,
        employeeId: emp.id,
        date: { gte: period.monthStart, lte: period.monthEnd },
      },
      include: { shiftType: { select: { startTime: true } } },
    });
    const calendarWhere: Record<string, unknown> = {
      tenantId,
      date: { gte: period.monthStart, lte: period.monthEnd },
    };
    if (emp.propertyId) {
      calendarWhere.OR = [{ propertyId: emp.propertyId }, { propertyId: null }];
    }
    const workCalendar = await (this.prisma as any).hrWorkCalendar.findMany({
      where: calendarWhere,
      select: { date: true, isWorkingDay: true },
    });

    const rosteredWorkingDates = new Set<string>();
    const holidayDates = new Set<string>();
    for (const a of assignments) {
      const key = this.dateKey(a.date);
      if (a.isDayOff) holidayDates.add(key);
      else rosteredWorkingDates.add(key);
    }
    for (const c of workCalendar) {
      if (!c.isWorkingDay) holidayDates.add(this.dateKey(c.date));
    }

    // ── Overtime ──────────────────────────────────────────────────────────
    let overtimePay = 0;
    if (policy.otRequiresApproval) {
      // OT ที่อนุมัติแล้วเป็น "เพดาน" (pre-authorization) — จำนวนที่จ่ายจริงต้อง
      // ไม่เกินเวลาทำงานจริงที่ตอกบัตรไว้ในวันนั้น (overtimeMinutes จากการ check-out)
      const otRequests = await (this.prisma as any).hrOvertimeRequest.findMany({
        where: {
          tenantId,
          employeeId: emp.id,
          status: 'approved',
          date: { gte: period.monthStart, lte: period.monthEnd },
        },
        orderBy: { date: 'asc' },
      });
      // OT จริงต่อวันจากการลงเวลาเข้า-ออก
      const actualAttendance = await (this.prisma as any).hrAttendance.findMany({
        where: {
          tenantId,
          employeeId: emp.id,
          date: { gte: period.monthStart, lte: period.monthEnd },
        },
        select: { date: true, overtimeMinutes: true },
      });
      const actualByDate = new Map<string, number>();
      for (const a of actualAttendance) {
        const key = this.dateKey(a.date);
        actualByDate.set(key, (actualByDate.get(key) ?? 0) + (a.overtimeMinutes ?? 0));
      }
      let payableMinutes = 0;
      for (const ot of otRequests) {
        const key = this.dateKey(ot.date);
        const remaining = actualByDate.get(key) ?? 0;
        // จ่ายไม่เกินที่อนุมัติ และไม่เกินที่ตอกบัตรจริง
        const minutes = Math.min(ot.minutes, remaining);
        if (minutes <= 0) continue;
        actualByDate.set(key, remaining - minutes); // กันนับซ้ำเมื่อมีหลายคำขอในวันเดียว
        overtimePay += hourlyRate * Number(ot.multiplier) * (minutes / 60);
        payableMinutes += minutes;
      }
      if (payableMinutes > 0) {
        items.push({
          type: 'overtime',
          name: `OT ${payableMinutes} นาที (อนุมัติ & ตอกบัตรจริง)`,
          amount: overtimePay,
        });
      }
    } else {
      const attendance = await (this.prisma as any).hrAttendance.findMany({
        where: {
          tenantId,
          employeeId: emp.id,
          date: { gte: period.monthStart, lte: period.monthEnd },
        },
        select: { date: true, overtimeMinutes: true },
      });
      // แยก OT วันทำงานปกติ (otMultiplier) กับ OT วันหยุด/วันoff (holidayOtMultiplier)
      let normalOtMinutes = 0;
      let holidayOtMinutes = 0;
      for (const a of attendance) {
        const minutes = a.overtimeMinutes ?? 0;
        if (minutes <= 0) continue;
        const key = a.date ? this.dateKey(a.date) : null;
        if (key && holidayDates.has(key)) holidayOtMinutes += minutes;
        else normalOtMinutes += minutes;
      }
      const normalOtPay = hourlyRate * Number(policy.otMultiplier) * (normalOtMinutes / 60);
      const holidayMultiplier = Number(policy.holidayOtMultiplier ?? policy.otMultiplier);
      const holidayOtPay =
        holidayOtMinutes > 0 ? hourlyRate * holidayMultiplier * (holidayOtMinutes / 60) : 0;
      overtimePay = normalOtPay + holidayOtPay;
      if (normalOtMinutes > 0) {
        items.push({ type: 'overtime', name: `OT ${normalOtMinutes} นาที`, amount: normalOtPay });
      }
      if (holidayOtMinutes > 0) {
        items.push({
          type: 'overtime',
          name: `OT วันหยุด ${holidayOtMinutes} นาที (x${holidayMultiplier})`,
          amount: holidayOtPay,
        });
      }
    }

    // ── Unpaid leave deduction ────────────────────────────────────────────
    const leaveRequests = await (this.prisma as any).hrLeaveRequest.findMany({
      where: {
        tenantId,
        employeeId: emp.id,
        status: 'approved',
        startDate: { lte: period.monthEnd },
        endDate: { gte: period.monthStart },
      },
      include: { leaveType: { select: { isPaid: true, name: true } } },
    });
    let unpaidLeaveDays = 0;
    for (const lr of leaveRequests) {
      const counts = !lr.leaveType?.isPaid || policy.paidLeaveDeducted;
      if (counts) unpaidLeaveDays += Number(lr.totalDays ?? 0);
    }
    const unpaidLeaveDeduction = dailyRate * Number(policy.unpaidLeaveRate) * unpaidLeaveDays;
    if (unpaidLeaveDeduction > 0) {
      items.push({
        type: 'deduction',
        name: `หักลาไม่รับเงิน ${unpaidLeaveDays} วัน`,
        amount: unpaidLeaveDeduction,
      });
    }

    // ── Absence (ขาดงาน) deduction ─────────────────────────────────────────
    // วันที่มีกะทำงาน (rostered) แต่ไม่มีการตอกบัตรเข้า และไม่มีใบลาที่อนุมัติ = ขาดงาน
    // หักเต็มวัน (dailyRate). เฉพาะ tenant ที่ใช้ระบบจัดกะ — ถ้าไม่มีกะจะไม่หัก
    let absentDays = 0;
    if (rosteredWorkingDates.size > 0) {
      const attendedRecords = await (this.prisma as any).hrAttendance.findMany({
        where: {
          tenantId,
          employeeId: emp.id,
          checkIn: { not: null },
          date: { gte: period.monthStart, lte: period.monthEnd },
        },
        select: { date: true },
      });
      const accountedDates = new Set<string>(
        attendedRecords.map((r: any) => this.dateKey(r.date)),
      );
      // ใบลาที่อนุมัติ (ทั้งแบบรับเงิน/ไม่รับเงิน) ถือว่า "ไม่ขาด" — กระจายช่วงวันที่
      const dayMs = 24 * 60 * 60 * 1000;
      for (const lr of leaveRequests) {
        let cursor = new Date(
          Math.max(new Date(lr.startDate).getTime(), period.monthStart.getTime()),
        );
        const end = new Date(
          Math.min(new Date(lr.endDate).getTime(), period.monthEnd.getTime()),
        );
        while (cursor.getTime() <= end.getTime()) {
          accountedDates.add(this.dateKey(cursor));
          cursor = new Date(cursor.getTime() + dayMs);
        }
      }
      for (const key of rosteredWorkingDates) {
        if (!accountedDates.has(key)) absentDays += 1;
      }
    }
    const absenceDeduction = dailyRate * absentDays;
    if (absenceDeduction > 0) {
      items.push({
        type: 'deduction',
        name: `หักขาดงาน ${absentDays} วัน`,
        amount: absenceDeduction,
      });
    }

    // ── Late deduction ────────────────────────────────────────────────────
    let lateDeduction = 0;
    if (Number(policy.lateDeductionPerMin) > 0) {
      const lateMinutes = await this.calcLateMinutes(emp.id, period, tenantId, assignments);
      lateDeduction = Number(policy.lateDeductionPerMin) * lateMinutes;
      if (lateDeduction > 0) {
        items.push({
          type: 'deduction',
          name: `หักมาสาย ${lateMinutes} นาที`,
          amount: lateDeduction,
        });
      }
    }

    // ── Social security ───────────────────────────────────────────────────
    let socialSecurity = 0;
    if (policy.socialSecurityEnabled) {
      socialSecurity = Math.min(
        baseSalary * Number(policy.socialSecurityRate),
        Number(policy.socialSecurityCap),
      );
      if (socialSecurity > 0) {
        items.push({ type: 'deduction', name: 'ประกันสังคม', amount: socialSecurity });
      }
    }

    // ── Withholding tax (ภาษีหัก ณ ที่จ่าย, ภงด.1) ─────────────────────────
    // วิธี: ประมาณการรายได้ทั้งปีจากเงินเดือนประจำ (baseSalary × 12) หักค่าใช้จ่าย
    // + ค่าลดหย่อน + ประกันสังคมทั้งปี แล้วคิดภาษีขั้นบันได ÷ 12 = ภาษีหักรายเดือน
    let tax = 0;
    if (policy.taxEnabled) {
      tax = this.computeWithholdingTax(baseSalary, socialSecurity, policy);
      if (tax > 0) {
        items.push({ type: 'deduction', name: 'ภาษีหัก ณ ที่จ่าย', amount: tax });
      }
    }

    // ── Caller-supplied items (allowances/deductions/bonus) ────────────────
    for (const i of extraItems) {
      items.push({ type: i.type, name: i.name, amount: i.amount, note: i.note });
    }

    const totalAllowance = items
      .filter((i) => i.type === 'allowance')
      .reduce((s, i) => s + i.amount, 0);
    const bonusPay = items.filter((i) => i.type === 'bonus').reduce((s, i) => s + i.amount, 0);
    const totalDeduction = items
      .filter((i) => i.type === 'deduction')
      .reduce((s, i) => s + i.amount, 0);

    const netSalary = baseSalary + overtimePay + totalAllowance + bonusPay - totalDeduction;

    return {
      baseSalary,
      overtimePay,
      totalAllowance,
      bonusPay,
      totalDeduction,
      netSalary,
      unpaidLeaveDays,
      absentDays,
      socialSecurity,
      tax,
      lateDeduction,
      items,
    };
  }

  /** Thai personal income tax brackets (ขั้นบันได) — upper bound + marginal rate. */
  private static readonly TAX_BRACKETS: ReadonlyArray<{ upTo: number; rate: number }> = [
    { upTo: 150_000, rate: 0 },
    { upTo: 300_000, rate: 0.05 },
    { upTo: 500_000, rate: 0.1 },
    { upTo: 750_000, rate: 0.15 },
    { upTo: 1_000_000, rate: 0.2 },
    { upTo: 2_000_000, rate: 0.25 },
    { upTo: 5_000_000, rate: 0.3 },
    { upTo: Number.POSITIVE_INFINITY, rate: 0.35 },
  ];

  /** Annual progressive tax on net taxable income. */
  private progressiveAnnualTax(netTaxable: number): number {
    if (netTaxable <= 0) return 0;
    let tax = 0;
    let lower = 0;
    for (const bracket of HrPayrollService.TAX_BRACKETS) {
      if (netTaxable <= lower) break;
      const span = Math.min(netTaxable, bracket.upTo) - lower;
      tax += span * bracket.rate;
      lower = bracket.upTo;
    }
    return tax;
  }

  /**
   * Monthly withholding tax: annualize regular salary, subtract the standard
   * 50%-capped expense deduction, personal + extra allowances, and annual
   * social security, then run progressive brackets and divide by 12 months.
   * Variable income (OT/bonus) is intentionally excluded from the projection.
   */
  private computeWithholdingTax(baseSalary: number, monthlySocialSecurity: number, policy: any): number {
    const annualIncome = baseSalary * 12;
    if (annualIncome <= 0) return 0;
    // กัน NaN/undefined (เช่น policy row เก่าก่อน migration) → ใช้ค่ามาตรฐาน
    const num = (value: unknown, fallback: number): number => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const expenseRate = num(policy.taxExpenseRate, 0.5);
    const expenseCap = num(policy.taxExpenseCap, 100_000);
    const personal = num(policy.taxPersonalAllowance, 60_000);
    const extra = num(policy.taxExtraAllowance, 0);
    const socialSecurityAnnual = monthlySocialSecurity * 12;

    const expense = Math.min(annualIncome * expenseRate, expenseCap);
    const netTaxable = Math.max(
      0,
      annualIncome - expense - personal - extra - socialSecurityAnnual,
    );
    return this.progressiveAnnualTax(netTaxable) / 12;
  }

  /** Sum late minutes against rostered start times for the period. */
  private async calcLateMinutes(
    employeeId: string,
    period: { monthStart: Date; monthEnd: Date },
    tenantId: string,
    assignments: any[],
  ): Promise<number> {
    const lateRecords = await (this.prisma as any).hrAttendance.findMany({
      where: {
        tenantId,
        employeeId,
        status: 'late',
        checkIn: { not: null },
        date: { gte: period.monthStart, lte: period.monthEnd },
      },
      select: { date: true, checkIn: true },
    });
    if (!lateRecords.length) return 0;

    const startByDate = new Map<string, string>();
    for (const a of assignments) {
      const key = new Date(a.date).toISOString().split('T')[0];
      const start = a.startTime ?? a.shiftType?.startTime ?? '09:00';
      startByDate.set(key, start);
    }

    let total = 0;
    for (const rec of lateRecords) {
      const key = new Date(rec.date).toISOString().split('T')[0];
      const start = startByDate.get(key) ?? '09:00';
      const [h, m] = start.split(':').map((n: string) => parseInt(n, 10));
      const scheduled = new Date(rec.date);
      scheduled.setUTCHours(h, m, 0, 0);
      const diff = Math.floor(
        (new Date(rec.checkIn).getTime() - scheduled.getTime()) / 60_000,
      );
      if (diff > 0) total += diff;
    }
    return total;
  }

  // ─── Workflow: Approve / Mark Paid / Cancel ────────────────────────────────────

  async approve(id: string, dto: ApprovePayrollDto, approverId: string, tenantId: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status !== 'draft') {
      throw new BadRequestException(`Payroll is already ${payroll.status}`);
    }

    const updated = await (this.prisma as any).hrPayroll.update({
      where: { id },
      data: {
        status: 'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
        note: dto.note ?? payroll.note,
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });

    await this.audit(AuditAction.PAYROLL_APPROVE, id, tenantId, approverId, 'draft', 'approved');
    this.logger.log(`Payroll ${id} approved by ${approverId}`);
    return updated;
  }

  async markPaid(id: string, tenantId: string, userId?: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status !== 'approved') {
      throw new BadRequestException('Only approved payrolls can be marked as paid');
    }
    const updated = await (this.prisma as any).hrPayroll.update({
      where: { id },
      data: { status: 'paid', paidAt: new Date() },
    });
    await this.audit(AuditAction.PAYROLL_PAID, id, tenantId, userId, 'approved', 'paid');
    return updated;
  }

  async cancel(id: string, tenantId: string, userId?: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status === 'paid') {
      throw new BadRequestException('Cannot cancel a paid payroll');
    }
    const updated = await (this.prisma as any).hrPayroll.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    await this.audit(AuditAction.PAYROLL_CANCEL, id, tenantId, userId, payroll.status, 'cancelled');
    return updated;
  }

  private async audit(
    action: AuditAction,
    resourceId: string,
    tenantId: string,
    userId: string | undefined,
    from: string,
    to: string,
  ) {
    await this.auditLog
      .log({
        action,
        resource: AuditResource.PAYROLL,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        oldValues: { status: from },
        newValues: { status: to },
        description: `Payroll ${to}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────

  async getSummary(query: Record<string, string>, tenantId: string) {
    const month = query.month ? parseInt(query.month, 10) : new Date().getMonth() + 1;
    const year = query.year ? parseInt(query.year, 10) : new Date().getFullYear();

    const payrolls = await (this.prisma as any).hrPayroll.findMany({
      where: { tenantId, month, year },
      select: {
        baseSalary: true,
        totalAllowance: true,
        totalDeduction: true,
        overtimePay: true,
        bonusPay: true,
        netSalary: true,
        status: true,
      },
    });

    const sum = (field: string) =>
      payrolls.reduce((s: number, p: any) => s + Number(p[field] ?? 0), 0);

    return {
      month,
      year,
      count: payrolls.length,
      totalBaseSalary: sum('baseSalary'),
      totalAllowance: sum('totalAllowance'),
      totalDeduction: sum('totalDeduction'),
      totalOvertime: sum('overtimePay'),
      totalBonus: sum('bonusPay'),
      totalNetSalary: sum('netSalary'),
      byStatus: {
        draft: payrolls.filter((p: any) => p.status === 'draft').length,
        approved: payrolls.filter((p: any) => p.status === 'approved').length,
        paid: payrolls.filter((p: any) => p.status === 'paid').length,
        cancelled: payrolls.filter((p: any) => p.status === 'cancelled').length,
      },
    };
  }
}
