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
import {
  CreateHrAttendanceExceptionDto,
  ReviewHrAttendanceExceptionDto,
} from './dto/create-hr-attendance-exception.dto';

/**
 * Attendance exception workflow (P1-03): missed punch, edit request, late/absent
 * reasons. On approval, the correction is applied to the linked attendance record
 * (creating one when necessary) so payroll can rely on clean data.
 */
@Injectable()
export class HrAttendanceExceptionService {
  private readonly logger = new Logger(HrAttendanceExceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private toDateOnly(value: string | Date): Date {
    const d = new Date(value);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;
    const { employeeId, status, type, dateFrom, dateTo } = query;

    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (status) where['status'] = status;
    if (type) where['type'] = type;
    if (dateFrom || dateTo) {
      where['date'] = {
        ...(dateFrom && { gte: this.toDateOnly(dateFrom) }),
        ...(dateTo && { lte: this.toDateOnly(dateTo) }),
      };
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).hrAttendanceException.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status: 'asc' }, { date: 'desc' }],
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
        },
      }),
      (this.prisma as any).hrAttendanceException.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrAttendanceException.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        attendance: true,
      },
    });
    if (!record) throw new NotFoundException(`Attendance exception ${id} not found`);
    return record;
  }

  async create(dto: CreateHrAttendanceExceptionDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const record = await (this.prisma as any).hrAttendanceException.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        attendanceId: dto.attendanceId ?? null,
        date: this.toDateOnly(dto.date),
        type: dto.type,
        requestedCheckIn: dto.requestedCheckIn ? new Date(dto.requestedCheckIn) : null,
        requestedCheckOut: dto.requestedCheckOut ? new Date(dto.requestedCheckOut) : null,
        reason: dto.reason,
        status: 'pending',
        createdBy: userId ?? null,
      },
    });

    await this.auditLog
      .log({
        action: AuditAction.ATTENDANCE_EXCEPTION_SUBMIT,
        resource: AuditResource.ATTENDANCE_EXCEPTION,
        resourceId: record.id,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues: { employeeId: dto.employeeId, type: dto.type, date: dto.date },
        description: `Attendance exception submitted (${dto.type})`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    return record;
  }

  async review(
    id: string,
    dto: ReviewHrAttendanceExceptionDto,
    reviewerId: string,
    tenantId: string,
  ) {
    const exception = await this.findOne(id, tenantId);
    if (exception.status !== 'pending') {
      throw new BadRequestException(`Exception is already ${exception.status}`);
    }

    const updated = await (this.prisma as any).hrAttendanceException.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote ?? null,
      },
    });

    if (dto.status === 'approved') {
      await this.applyCorrection(exception, tenantId);
    }

    await this.auditLog
      .log({
        action:
          dto.status === 'approved'
            ? AuditAction.ATTENDANCE_EXCEPTION_APPROVE
            : AuditAction.ATTENDANCE_EXCEPTION_REJECT,
        resource: AuditResource.ATTENDANCE_EXCEPTION,
        resourceId: id,
        category: AuditCategory.HR,
        tenantId,
        userId: reviewerId,
        oldValues: { status: 'pending' },
        newValues: { status: dto.status },
        description: `Attendance exception ${dto.status}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(`Attendance exception ${id} ${dto.status} by ${reviewerId}`);
    return updated;
  }

  /**
   * Apply an approved correction to the attendance record. Recomputes work/OT
   * minutes against an 8h baseline when both punches are known.
   */
  private async applyCorrection(exception: any, tenantId: string) {
    if (!exception.requestedCheckIn && !exception.requestedCheckOut) return;

    const date = this.toDateOnly(exception.date);
    let attendance = exception.attendanceId
      ? await (this.prisma as any).hrAttendance.findFirst({
          where: { id: exception.attendanceId, tenantId },
        })
      : await (this.prisma as any).hrAttendance.findUnique({
          where: { employeeId_date: { employeeId: exception.employeeId, date } },
        });

    const checkIn = exception.requestedCheckIn ?? attendance?.checkIn ?? null;
    const checkOut = exception.requestedCheckOut ?? attendance?.checkOut ?? null;

    let workMinutes: number | null = attendance?.workMinutes ?? null;
    let overtimeMinutes: number | null = attendance?.overtimeMinutes ?? null;
    if (checkIn && checkOut) {
      const total = Math.max(
        0,
        Math.floor((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60_000),
      );
      workMinutes = Math.min(total, 8 * 60);
      overtimeMinutes = Math.max(0, total - 8 * 60);
    }

    if (attendance) {
      await (this.prisma as any).hrAttendance.update({
        where: { id: attendance.id },
        data: {
          checkIn,
          checkOut,
          workMinutes,
          overtimeMinutes,
          status: 'present',
          note: `[exception ${exception.id}] ${exception.reason}`,
        },
      });
    } else {
      attendance = await (this.prisma as any).hrAttendance.create({
        data: {
          tenantId,
          employeeId: exception.employeeId,
          date,
          checkIn,
          checkOut,
          workMinutes,
          overtimeMinutes,
          status: 'present',
          note: `[exception ${exception.id}] ${exception.reason}`,
        },
      });
      await (this.prisma as any).hrAttendanceException.update({
        where: { id: exception.id },
        data: { attendanceId: attendance.id },
      });
    }
  }
}
