import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Workforce analytics (P3-04): headcount, absenteeism, OT cost, turnover,
 * and compliance (expiring documents/certifications).
 */
@Injectable()
export class HrAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(tenantId: string, month?: number, year?: number) {
    const now = new Date();
    const m = month ?? now.getMonth() + 1;
    const y = year ?? now.getFullYear();
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));

    const [byStatus, employees, attendance, payrolls, offboardings, docExpiring, certExpiring] =
      await Promise.all([
        (this.prisma.employee as any).groupBy({
          by: ['status'],
          where: { tenantId },
          _count: { _all: true },
        }),
        (this.prisma.employee as any).findMany({
          where: { tenantId },
          select: { department: true, status: true },
        }),
        (this.prisma as any).hrAttendance.groupBy({
          by: ['status'],
          where: { tenantId, date: { gte: monthStart, lte: monthEnd } },
          _count: { _all: true },
        }),
        (this.prisma as any).hrPayroll.findMany({
          where: { tenantId, month: m, year: y },
          select: { overtimePay: true, netSalary: true },
        }),
        (this.prisma as any).hrOffboarding.count({
          where: { tenantId, status: 'completed', completedAt: { gte: monthStart, lte: monthEnd } },
        }),
        (this.prisma as any).hrEmployeeDocument.count({
          where: {
            tenantId,
            deletedAt: null,
            expiresAt: { not: null, lte: this.inDays(30) },
          },
        }),
        (this.prisma as any).hrTrainingRecord.count({
          where: { tenantId, type: 'certification', expiresAt: { not: null, lte: this.inDays(30) } },
        }),
      ]);

    const headcountByStatus: Record<string, number> = {};
    for (const row of byStatus) headcountByStatus[row.status] = row._count._all;
    const activeHeadcount =
      (headcountByStatus['ACTIVE'] ?? 0) + (headcountByStatus['PROBATION'] ?? 0);

    const byDepartment: Record<string, number> = {};
    for (const e of employees) {
      if (e.status === 'ACTIVE' || e.status === 'PROBATION') {
        const key = e.department || 'ไม่ระบุ';
        byDepartment[key] = (byDepartment[key] ?? 0) + 1;
      }
    }

    const att: Record<string, number> = {};
    for (const row of attendance) att[row.status] = row._count._all;
    const totalAtt = Object.values(att).reduce((s, n) => s + n, 0) || 1;
    const absenteeismRate = ((att['absent'] ?? 0) + (att['late'] ?? 0)) / totalAtt;

    const otCost = payrolls.reduce((s: number, p: any) => s + Number(p.overtimePay ?? 0), 0);
    const payrollTotal = payrolls.reduce((s: number, p: any) => s + Number(p.netSalary ?? 0), 0);
    const turnoverRate = activeHeadcount ? offboardings / activeHeadcount : 0;

    return {
      period: { month: m, year: y },
      headcount: { total: activeHeadcount, byStatus: headcountByStatus, byDepartment },
      attendance: {
        counts: att,
        absenteeismRate: Number(absenteeismRate.toFixed(4)),
        present: att['present'] ?? 0,
        late: att['late'] ?? 0,
        absent: att['absent'] ?? 0,
      },
      payroll: { otCost, payrollTotal },
      turnover: { offboardedThisMonth: offboardings, turnoverRate: Number(turnoverRate.toFixed(4)) },
      compliance: { documentsExpiring: docExpiring, certificationsExpiring: certExpiring },
    };
  }

  private inDays(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  }
}
