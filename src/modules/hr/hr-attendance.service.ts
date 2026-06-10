import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckInDto, CheckOutDto, CreateHrAttendanceDto } from './dto/create-hr-attendance.dto';

@Injectable()
export class HrAttendanceService {
  private readonly logger = new Logger(HrAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Query ───────────────────────────────────────────────────────────────────

  async findAll(query: Record<string, string>, tenantId: string) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const { employeeId, status, dateFrom, dateTo, search } = query;

    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (status) where['status'] = status;
    if (dateFrom || dateTo) {
      where['date'] = {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo && { lte: new Date(dateTo) }),
      };
    }
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
      (this.prisma as any).hrAttendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { checkIn: 'desc' }],
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
        },
      }),
      (this.prisma as any).hrAttendance.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrAttendance.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            propertyId: true,
          },
        },
      },
    });
    if (!record) throw new NotFoundException(`Attendance record ${id} not found`);
    return record;
  }

  // ─── Shift-aware helpers (P1-04) ───────────────────────────────────────────

  /** Default late grace in minutes when a policy/shift does not override it. */
  private static readonly LATE_GRACE_MINUTES = 15;
  /** Fallback scheduled start when no shift roster exists for the day. */
  private static readonly DEFAULT_START = '09:00';

  /** Resolve the planned shift for an employee on a date (roster + override). */
  private async resolveShift(employeeId: string, date: Date, tenantId: string) {
    const assignment = await (this.prisma as any).hrShiftAssignment.findUnique({
      where: { employeeId_date: { employeeId, date } },
      include: { shiftType: true },
    });
    if (!assignment) return null;
    const startTime = assignment.startTime ?? assignment.shiftType?.startTime ?? null;
    const endTime = assignment.endTime ?? assignment.shiftType?.endTime ?? null;
    const breakMinutes = assignment.shiftType?.breakMinutes ?? 0;
    return { assignment, startTime, endTime, breakMinutes, isDayOff: assignment.isDayOff };
  }

  /** Is the date a non-working calendar day (holiday) for this tenant/property? */
  private async isHoliday(date: Date, tenantId: string, propertyId?: string | null) {
    const entry = await (this.prisma as any).hrWorkCalendar.findFirst({
      where: {
        tenantId,
        date,
        isWorkingDay: false,
        OR: [{ propertyId: null }, ...(propertyId ? [{ propertyId }] : [])],
      },
    });
    return Boolean(entry);
  }

  /** Combine a date (UTC midnight) with an HH:mm string into a Date. */
  private atTime(date: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
    const d = new Date(date);
    d.setUTCHours(h, m, 0, 0);
    return d;
  }

  /** Planned working minutes for a shift (end − start − break), default 480. */
  private plannedWorkMinutes(
    date: Date,
    startTime: string | null,
    endTime: string | null,
    breakMinutes: number,
  ): number {
    if (!startTime || !endTime) return 8 * 60;
    let diff =
      (this.atTime(date, endTime).getTime() - this.atTime(date, startTime).getTime()) / 60_000;
    if (diff <= 0) diff += 24 * 60; // overnight shift
    return Math.max(0, Math.round(diff) - breakMinutes);
  }

  // ─── Check-in / Check-out ────────────────────────────────────────────────────

  async checkIn(dto: CheckInDto, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const now = new Date();
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : now;
    const dateOnly = new Date(checkIn);
    dateOnly.setUTCHours(0, 0, 0, 0);

    // Guard: prevent duplicate check-in for the same day
    const existing = await (this.prisma as any).hrAttendance.findUnique({
      where: { employeeId_date: { employeeId: dto.employeeId, date: dateOnly } },
    });
    if (existing) {
      throw new ConflictException(
        `Employee ${dto.employeeId} already has an attendance record for ${dateOnly.toISOString().split('T')[0]}`,
      );
    }

    // Determine status against the rostered shift instead of a hardcoded hour.
    const shift = await this.resolveShift(dto.employeeId, dateOnly, tenantId);
    const scheduledStart = shift?.startTime ?? HrAttendanceService.DEFAULT_START;
    const graceMs = HrAttendanceService.LATE_GRACE_MINUTES * 60_000;
    const startBoundary = this.atTime(dateOnly, scheduledStart).getTime() + graceMs;
    const status =
      shift?.isDayOff || checkIn.getTime() <= startBoundary ? 'present' : 'late';

    const record = await (this.prisma as any).hrAttendance.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        date: dateOnly,
        checkIn,
        status,
        note: dto.note ?? null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });

    this.logger.log(
      `Check-in: Employee ${dto.employeeId} at ${checkIn.toISOString()} ` +
        `(status: ${status}, scheduledStart: ${scheduledStart})`,
    );
    return record;
  }

  async checkOut(id: string, dto: CheckOutDto, tenantId: string) {
    const record = await this.findOne(id, tenantId);

    if (!record.checkIn) {
      throw new BadRequestException('Cannot check out without a check-in record');
    }
    if (record.checkOut) {
      throw new ConflictException('Employee has already checked out');
    }

    const checkOut = dto.checkOut ? new Date(dto.checkOut) : new Date();
    const checkInTime = new Date(record.checkIn);

    if (checkOut <= checkInTime) {
      throw new BadRequestException('Check-out time must be after check-in time');
    }

    const totalMinutes = Math.floor((checkOut.getTime() - checkInTime.getTime()) / 60_000);

    // Regular vs OT split is driven by the rostered shift length, not a fixed 8h.
    // Day-off / holiday work counts entirely as overtime.
    const dateOnly = new Date(record.date);
    dateOnly.setUTCHours(0, 0, 0, 0);
    const shift = await this.resolveShift(record.employeeId, dateOnly, tenantId);
    const holiday = await this.isHoliday(dateOnly, tenantId, record.employee?.propertyId);

    let workMinutes: number;
    let overtimeMinutes: number;
    if (shift?.isDayOff || holiday) {
      workMinutes = 0;
      overtimeMinutes = totalMinutes;
    } else {
      const planned = this.plannedWorkMinutes(
        dateOnly,
        shift?.startTime ?? null,
        shift?.endTime ?? null,
        shift?.breakMinutes ?? 0,
      );
      workMinutes = Math.min(totalMinutes, planned);
      overtimeMinutes = Math.max(0, totalMinutes - planned);
    }

    const updated = await (this.prisma as any).hrAttendance.update({
      where: { id },
      data: {
        checkOut,
        workMinutes,
        overtimeMinutes,
        note: dto.note ?? record.note,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });

    this.logger.log(`Check-out: Attendance ${id} — ${workMinutes}m work, ${overtimeMinutes}m OT`);
    return updated;
  }

  // ─── Manual CRUD ─────────────────────────────────────────────────────────────

  async create(dto: CreateHrAttendanceDto, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const dateOnly = new Date(dto.date);
    dateOnly.setUTCHours(0, 0, 0, 0);

    return (this.prisma as any).hrAttendance.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        date: dateOnly,
        checkIn: dto.checkIn ? new Date(dto.checkIn) : null,
        checkOut: dto.checkOut ? new Date(dto.checkOut) : null,
        status: dto.status ?? 'present',
        workMinutes: dto.workMinutes ?? null,
        overtimeMinutes: dto.overtimeMinutes ?? null,
        note: dto.note ?? null,
      },
    });
  }

  async update(id: string, data: Partial<CreateHrAttendanceDto>, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrAttendance.update({
      where: { id },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.checkIn && { checkIn: new Date(data.checkIn) }),
        ...(data.checkOut && { checkOut: new Date(data.checkOut) }),
        ...(data.workMinutes !== undefined && { workMinutes: data.workMinutes }),
        ...(data.overtimeMinutes !== undefined && { overtimeMinutes: data.overtimeMinutes }),
        ...(data.note !== undefined && { note: data.note }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrAttendance.delete({ where: { id } });
  }

  // ─── Summary stats ───────────────────────────────────────────────────────────

  async getSummary(query: Record<string, string>, tenantId: string) {
    const { dateFrom, dateTo } = query;
    const dateWhere = {
      ...(dateFrom && { gte: new Date(dateFrom) }),
      ...(dateTo && { lte: new Date(dateTo) }),
    };

    const [present, late, absent, onLeave] = await Promise.all([
      (this.prisma as any).hrAttendance.count({
        where: {
          tenantId,
          status: 'present',
          ...(Object.keys(dateWhere).length && { date: dateWhere }),
        },
      }),
      (this.prisma as any).hrAttendance.count({
        where: {
          tenantId,
          status: 'late',
          ...(Object.keys(dateWhere).length && { date: dateWhere }),
        },
      }),
      (this.prisma as any).hrAttendance.count({
        where: {
          tenantId,
          status: 'absent',
          ...(Object.keys(dateWhere).length && { date: dateWhere }),
        },
      }),
      (this.prisma as any).hrAttendance.count({
        where: {
          tenantId,
          status: 'on_leave',
          ...(Object.keys(dateWhere).length && { date: dateWhere }),
        },
      }),
    ]);

    return { present, late, absent, onLeave, total: present + late + absent + onLeave };
  }
}
