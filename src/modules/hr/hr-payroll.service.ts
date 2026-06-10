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
import { RunPayrollDto, ApprovePayrollDto } from './dto/run-payroll.dto';

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

    // ── Overtime ──────────────────────────────────────────────────────────
    let overtimePay = 0;
    if (policy.otRequiresApproval) {
      const otRequests = await (this.prisma as any).hrOvertimeRequest.findMany({
        where: {
          tenantId,
          employeeId: emp.id,
          status: 'approved',
          date: { gte: period.monthStart, lte: period.monthEnd },
        },
      });
      for (const ot of otRequests) {
        const pay = hourlyRate * Number(ot.multiplier) * (ot.minutes / 60);
        overtimePay += pay;
      }
      if (otRequests.length) {
        const totalMin = otRequests.reduce((s: number, o: any) => s + o.minutes, 0);
        items.push({
          type: 'overtime',
          name: `OT อนุมัติ ${totalMin} นาที`,
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
        select: { overtimeMinutes: true },
      });
      const totalOtMinutes = attendance.reduce(
        (s: number, a: any) => s + (a.overtimeMinutes ?? 0),
        0,
      );
      overtimePay = hourlyRate * Number(policy.otMultiplier) * (totalOtMinutes / 60);
      if (totalOtMinutes > 0) {
        items.push({
          type: 'overtime',
          name: `OT ${totalOtMinutes} นาที`,
          amount: overtimePay,
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

    // ── Late deduction ────────────────────────────────────────────────────
    let lateDeduction = 0;
    if (Number(policy.lateDeductionPerMin) > 0) {
      const lateMinutes = await this.calcLateMinutes(emp.id, period, tenantId);
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
      socialSecurity,
      lateDeduction,
      items,
    };
  }

  /** Sum late minutes against rostered start times for the period. */
  private async calcLateMinutes(
    employeeId: string,
    period: { monthStart: Date; monthEnd: Date },
    tenantId: string,
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

    const assignments = await (this.prisma as any).hrShiftAssignment.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: period.monthStart, lte: period.monthEnd },
      },
      include: { shiftType: { select: { startTime: true } } },
    });
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
