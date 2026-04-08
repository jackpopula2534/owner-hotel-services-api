import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RunPayrollDto, ApprovePayrollDto } from './dto/run-payroll.dto';

@Injectable()
export class HrPayrollService {
  private readonly logger = new Logger(HrPayrollService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── List & Detail ────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page  = parseInt(query.page  ?? '1',  10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip  = (page - 1) * limit;

    const { status, search } = query;
    const month = query.month ? parseInt(query.month, 10) : undefined;
    const year  = query.year  ? parseInt(query.year,  10) : undefined;

    const where: Record<string, unknown> = { tenantId };
    if (status) where['status'] = status;
    if (month)  where['month']  = month;
    if (year)   where['year']   = year;
    if (search) {
      where['employee'] = {
        OR: [
          { firstName:    { contains: search } },
          { lastName:     { contains: search } },
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
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true } },
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
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true, position: true, bankAccount: true } },
        items: { orderBy: { type: 'asc' } },
      },
    });
    if (!payroll) throw new NotFoundException(`Payroll record ${id} not found`);
    return payroll;
  }

  // ─── Run Payroll ──────────────────────────────────────────────────────────────

  /**
   * Bulk-generate payroll records for a given month/year.
   * For each active employee (or specified subset):
   *   - netSalary = baseSalary + overtimePay + bonusPay + totalAllowance − totalDeduction
   * OT pay is derived from the month's attendance records automatically.
   */
  async runPayroll(dto: RunPayrollDto, tenantId: string) {
    const { month, year, employeeIds, items } = dto;

    // Fetch target employees
    const employeeWhere: Record<string, unknown> = { tenantId, status: 'ACTIVE' };
    if (employeeIds?.length) employeeWhere['id'] = { in: employeeIds };

    const employees = await (this.prisma.employee as any).findMany({ where: employeeWhere });
    if (!employees.length) throw new BadRequestException('No active employees found');

    const results: any[] = [];
    const errors: string[] = [];

    for (const emp of employees) {
      try {
        // Guard: skip if payroll already exists for this period
        const existing = await (this.prisma as any).hrPayroll.findFirst({
          where: { tenantId, employeeId: emp.id, month, year },
        });
        if (existing) {
          errors.push(`Payroll already exists for employee ${emp.employeeCode ?? emp.id} (${month}/${year})`);
          continue;
        }

        const baseSalary = Number(emp.baseSalary ?? 0);

        // Calculate OT pay from attendance records for the month
        const monthStart = new Date(`${year}-${String(month).padStart(2, '0')}-01`);
        const monthEnd   = new Date(year, month, 0); // last day of month
        const attendance = await (this.prisma as any).hrAttendance.findMany({
          where: {
            tenantId,
            employeeId: emp.id,
            date: { gte: monthStart, lte: monthEnd },
          },
          select: { overtimeMinutes: true },
        });

        const totalOtMinutes = attendance.reduce(
          (sum: number, a: any) => sum + (a.overtimeMinutes ?? 0),
          0,
        );
        // OT rate: 1.5× of hourly rate (baseSalary / 30 days / 8 hours)
        const hourlyRate  = baseSalary / 30 / 8;
        const overtimePay = totalOtMinutes > 0 ? hourlyRate * 1.5 * (totalOtMinutes / 60) : 0;

        // Process additional items (allowances/deductions/bonus)
        const payrollItems = items ?? [];
        const totalAllowance = payrollItems
          .filter((i) => i.type === 'allowance')
          .reduce((s, i) => s + i.amount, 0);
        const totalDeduction = payrollItems
          .filter((i) => i.type === 'deduction')
          .reduce((s, i) => s + i.amount, 0);
        const bonusPay = payrollItems
          .filter((i) => i.type === 'bonus')
          .reduce((s, i) => s + i.amount, 0);

        const netSalary = baseSalary + overtimePay + totalAllowance + bonusPay - totalDeduction;

        const payroll = await (this.prisma as any).hrPayroll.create({
          data: {
            tenantId,
            employeeId:     emp.id,
            month,
            year,
            baseSalary:     baseSalary.toFixed(2),
            totalAllowance: totalAllowance.toFixed(2),
            totalDeduction: totalDeduction.toFixed(2),
            overtimePay:    overtimePay.toFixed(2),
            bonusPay:       bonusPay.toFixed(2),
            netSalary:      netSalary.toFixed(2),
            status:         'draft',
            items: {
              create: [
                ...payrollItems.map((item) => ({
                  type:   item.type,
                  name:   item.name,
                  amount: item.amount.toFixed(2),
                  note:   item.note ?? null,
                })),
                ...(totalOtMinutes > 0
                  ? [{ type: 'overtime', name: `OT ${totalOtMinutes} นาที`, amount: overtimePay.toFixed(2) }]
                  : []),
              ],
            },
          },
          include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } }, items: true },
        });

        results.push(payroll);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to run payroll for employee ${emp.id}: ${msg}`);
        errors.push(`Employee ${emp.employeeCode ?? emp.id}: ${msg}`);
      }
    }

    this.logger.log(`Payroll run complete: ${results.length} created, ${errors.length} errors`);
    return { created: results.length, errors, data: results };
  }

  // ─── Workflow: Approve / Mark Paid ────────────────────────────────────────────

  async approve(id: string, dto: ApprovePayrollDto, approverId: string, tenantId: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status !== 'draft') {
      throw new BadRequestException(`Payroll is already ${payroll.status}`);
    }

    const updated = await (this.prisma as any).hrPayroll.update({
      where: { id },
      data: {
        status:     'approved',
        approvedBy: approverId,
        approvedAt: new Date(),
        note:       dto.note ?? payroll.note,
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
    });

    this.logger.log(`Payroll ${id} approved by ${approverId}`);
    return updated;
  }

  async markPaid(id: string, tenantId: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status !== 'approved') {
      throw new BadRequestException('Only approved payrolls can be marked as paid');
    }

    return (this.prisma as any).hrPayroll.update({
      where: { id },
      data: { status: 'paid', paidAt: new Date() },
    });
  }

  async cancel(id: string, tenantId: string) {
    const payroll = await this.findOne(id, tenantId);
    if (payroll.status === 'paid') {
      throw new BadRequestException('Cannot cancel a paid payroll');
    }
    return (this.prisma as any).hrPayroll.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────

  async getSummary(query: Record<string, string>, tenantId: string) {
    const month = query.month ? parseInt(query.month, 10) : new Date().getMonth() + 1;
    const year  = query.year  ? parseInt(query.year,  10) : new Date().getFullYear();

    const payrolls = await (this.prisma as any).hrPayroll.findMany({
      where: { tenantId, month, year },
      select: { baseSalary: true, totalAllowance: true, totalDeduction: true, overtimePay: true, bonusPay: true, netSalary: true, status: true },
    });

    const sum = (field: string) =>
      payrolls.reduce((s: number, p: any) => s + Number(p[field] ?? 0), 0);

    return {
      month, year,
      count:          payrolls.length,
      totalBaseSalary: sum('baseSalary'),
      totalAllowance:  sum('totalAllowance'),
      totalDeduction:  sum('totalDeduction'),
      totalOvertime:   sum('overtimePay'),
      totalBonus:      sum('bonusPay'),
      totalNetSalary:  sum('netSalary'),
      byStatus: {
        draft:     payrolls.filter((p: any) => p.status === 'draft').length,
        approved:  payrolls.filter((p: any) => p.status === 'approved').length,
        paid:      payrolls.filter((p: any) => p.status === 'paid').length,
        cancelled: payrolls.filter((p: any) => p.status === 'cancelled').length,
      },
    };
  }
}
