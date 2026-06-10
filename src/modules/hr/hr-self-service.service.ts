import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Employee self-service aggregate (P3-01/02). Returns one employee's own
 * profile, recent payslips, leave balance, attendance history, upcoming
 * shifts and training in a single payload.
 */
@Injectable()
export class HrSelfServiceService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(employeeId: string, tenantId: string, year?: number) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: employeeId, tenantId },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        department: true, position: true, status: true, startDate: true, email: true,
      },
    });
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    const yr = year ?? new Date().getFullYear();
    const yearStart = new Date(Date.UTC(yr, 0, 1));
    const yearEnd = new Date(Date.UTC(yr, 11, 31, 23, 59, 59));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [payslips, leaveRequests, attendance, upcomingShifts, training] = await Promise.all([
      (this.prisma as any).hrPayroll.findMany({
        where: { tenantId, employeeId, status: { in: ['approved', 'paid'] } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 6,
        select: { id: true, month: true, year: true, netSalary: true, status: true, paidAt: true },
      }),
      (this.prisma as any).hrLeaveRequest.findMany({
        where: { tenantId, employeeId, startDate: { gte: yearStart, lte: yearEnd } },
        include: { leaveType: { select: { name: true, isPaid: true } } },
        orderBy: { startDate: 'desc' },
      }),
      (this.prisma as any).hrAttendance.findMany({
        where: { tenantId, employeeId },
        orderBy: { date: 'desc' },
        take: 30,
        select: { id: true, date: true, checkIn: true, checkOut: true, status: true, workMinutes: true, overtimeMinutes: true },
      }),
      (this.prisma as any).hrShiftAssignment.findMany({
        where: { tenantId, employeeId, date: { gte: today } },
        orderBy: { date: 'asc' },
        take: 14,
        include: { shiftType: { select: { name: true, startTime: true, endTime: true, color: true } } },
      }),
      (this.prisma as any).hrTrainingRecord.findMany({
        where: { tenantId, employeeId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Leave balance summary (approved days taken, by paid/unpaid)
    const approved = leaveRequests.filter((l: any) => l.status === 'approved');
    const paidDays = approved
      .filter((l: any) => l.leaveType?.isPaid)
      .reduce((s: number, l: any) => s + Number(l.totalDays ?? 0), 0);
    const unpaidDays = approved
      .filter((l: any) => !l.leaveType?.isPaid)
      .reduce((s: number, l: any) => s + Number(l.totalDays ?? 0), 0);

    return {
      employee,
      payslips,
      leave: {
        year: yr,
        requests: leaveRequests,
        summary: { paidDaysTaken: paidDays, unpaidDaysTaken: unpaidDays, pending: leaveRequests.filter((l: any) => l.status === 'pending').length },
      },
      attendance,
      upcomingShifts,
      training,
    };
  }
}
