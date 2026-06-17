import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHrShiftAssignmentDto,
  UpdateHrShiftAssignmentDto,
  BulkCreateHrShiftAssignmentDto,
} from './dto/create-hr-shift-assignment.dto';
import {
  CreateHrWorkCalendarDto,
  UpdateHrWorkCalendarDto,
} from './dto/create-hr-work-calendar.dto';

/**
 * Shift roster + work calendar service (P1-01/P1-02).
 *
 * Owns daily/weekly shift assignment per employee and the tenant work calendar
 * (holidays / special days) used by attendance + payroll engines.
 */
@Injectable()
export class HrShiftService {
  private readonly logger = new Logger(HrShiftService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toDateOnly(value: string | Date): Date {
    const d = new Date(value);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private static readonly TH_WEEKDAYS = [
    'วันอาทิตย์',
    'วันจันทร์',
    'วันอังคาร',
    'วันพุธ',
    'วันพฤหัสบดี',
    'วันศุกร์',
    'วันเสาร์',
  ];

  /**
   * โยน BadRequestException ถ้าวันที่ตรงกับวันหยุดที่แผนกกำหนดไว้และบังคับใช้ (enforceOffDays)
   * แผนกที่ไม่มีนโยบาย หรือ pattern ยืดหยุ่น (enforceOffDays=false) จะลงกะได้ตามปกติ
   */
  private async assertNotDepartmentOffDay(
    tenantId: string,
    departmentId: string,
    date: Date,
  ): Promise<void> {
    const policy = await (this.prisma as any).hrDepartmentWorkPolicy.findFirst({
      where: { tenantId, departmentId, isActive: true },
      select: { offDays: true, enforceOffDays: true, department: { select: { name: true } } },
    });
    if (!policy || !policy.enforceOffDays) return;

    const offDays: number[] = Array.isArray(policy.offDays) ? policy.offDays : [];
    const weekday = date.getUTCDay();
    if (offDays.includes(weekday)) {
      const dayName = HrShiftService.TH_WEEKDAYS[weekday] ?? `วัน ${weekday}`;
      const deptName = policy.department?.name ?? 'แผนกนี้';
      throw new BadRequestException(
        `${dayName}เป็นวันหยุดของ${deptName} ไม่สามารถลงกะทำงานได้ (กำหนดวันหยุดไว้ในตั้งค่าการทำงาน)`,
      );
    }
  }

  // ─── Shift Assignments ─────────────────────────────────────────────────────

  async findAssignments(query: Record<string, string>, tenantId: string) {
    const { employeeId, departmentId, propertyId, shiftTypeId, status, dateFrom, dateTo } = query;

    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (departmentId) where['departmentId'] = departmentId;
    if (propertyId) where['propertyId'] = propertyId;
    if (shiftTypeId) where['shiftTypeId'] = shiftTypeId;
    if (status) where['status'] = status;
    if (dateFrom || dateTo) {
      where['date'] = {
        ...(dateFrom && { gte: this.toDateOnly(dateFrom) }),
        ...(dateTo && { lte: this.toDateOnly(dateTo) }),
      };
    }

    const data = await (this.prisma as any).hrShiftAssignment.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true },
        },
        shiftType: {
          select: { id: true, name: true, code: true, startTime: true, endTime: true, color: true },
        },
      },
    });

    return { data, total: data.length };
  }

  async findAssignment(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrShiftAssignment.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
        shiftType: true,
      },
    });
    if (!record) throw new NotFoundException(`Shift assignment ${id} not found`);
    return record;
  }

  /**
   * Upsert a single roster entry. (employeeId, date) is unique, so re-assigning
   * the same day overwrites the previous shift instead of erroring.
   */
  async assign(dto: CreateHrShiftAssignmentDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    if (!dto.isDayOff && !dto.shiftTypeId && !(dto.startTime && dto.endTime)) {
      throw new BadRequestException(
        'A working shift requires either a shiftTypeId or both startTime and endTime',
      );
    }

    const date = this.toDateOnly(dto.date);
    const departmentId = dto.departmentId ?? employee.departmentId ?? null;

    // บังคับตามนโยบายวันหยุดของแผนก: ห้ามลงกะทำงานในวันหยุดที่กำหนด (เฉพาะกะทำงาน ไม่ใช่วันหยุด)
    if (!dto.isDayOff && departmentId) {
      await this.assertNotDepartmentOffDay(tenantId, departmentId, date);
    }

    const data = {
      tenantId,
      employeeId: dto.employeeId,
      shiftTypeId: dto.shiftTypeId ?? null,
      propertyId: dto.propertyId ?? employee.propertyId ?? null,
      departmentId,
      date,
      startTime: dto.startTime ?? null,
      endTime: dto.endTime ?? null,
      isDayOff: dto.isDayOff ?? false,
      status: dto.status ?? 'scheduled',
      note: dto.note ?? null,
      createdBy: userId ?? null,
    };

    const record = await (this.prisma as any).hrShiftAssignment.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
      create: data,
      update: {
        shiftTypeId: data.shiftTypeId,
        propertyId: data.propertyId,
        departmentId: data.departmentId,
        startTime: data.startTime,
        endTime: data.endTime,
        isDayOff: data.isDayOff,
        status: data.status,
        note: data.note,
      },
    });

    this.logger.log(`Shift assigned: employee ${dto.employeeId} on ${dto.date}`);
    return record;
  }

  async bulkAssign(dto: BulkCreateHrShiftAssignmentDto, tenantId: string, userId?: string) {
    const results: any[] = [];
    const errors: string[] = [];
    for (const entry of dto.assignments) {
      try {
        results.push(await this.assign(entry, tenantId, userId));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.employeeId} / ${entry.date}: ${msg}`);
      }
    }
    this.logger.log(`Bulk roster: ${results.length} upserted, ${errors.length} errors`);
    return { upserted: results.length, errors, data: results };
  }

  async updateAssignment(id: string, dto: UpdateHrShiftAssignmentDto, tenantId: string) {
    await this.findAssignment(id, tenantId);
    return (this.prisma as any).hrShiftAssignment.update({
      where: { id },
      data: {
        ...(dto.shiftTypeId !== undefined && { shiftTypeId: dto.shiftTypeId }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.isDayOff !== undefined && { isDayOff: dto.isDayOff }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async removeAssignment(id: string, tenantId: string) {
    await this.findAssignment(id, tenantId);
    return (this.prisma as any).hrShiftAssignment.delete({ where: { id } });
  }

  // ─── Work Calendar ─────────────────────────────────────────────────────────

  async findCalendar(query: Record<string, string>, tenantId: string) {
    const { propertyId, type, dateFrom, dateTo } = query;
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where['propertyId'] = propertyId;
    if (type) where['type'] = type;
    if (dateFrom || dateTo) {
      where['date'] = {
        ...(dateFrom && { gte: this.toDateOnly(dateFrom) }),
        ...(dateTo && { lte: this.toDateOnly(dateTo) }),
      };
    }
    const data = await (this.prisma as any).hrWorkCalendar.findMany({
      where,
      orderBy: { date: 'asc' },
    });
    return { data, total: data.length };
  }

  async createCalendarEntry(dto: CreateHrWorkCalendarDto, tenantId: string) {
    const date = this.toDateOnly(dto.date);
    return (this.prisma as any).hrWorkCalendar.create({
      data: {
        tenantId,
        propertyId: dto.propertyId ?? null,
        date,
        name: dto.name,
        type: dto.type ?? 'holiday',
        isWorkingDay: dto.isWorkingDay ?? false,
        payMultiplier: (dto.payMultiplier ?? 1).toFixed(2),
        note: dto.note ?? null,
      },
    });
  }

  async updateCalendarEntry(id: string, dto: UpdateHrWorkCalendarDto, tenantId: string) {
    const existing = await (this.prisma as any).hrWorkCalendar.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Work calendar entry ${id} not found`);
    return (this.prisma as any).hrWorkCalendar.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.isWorkingDay !== undefined && { isWorkingDay: dto.isWorkingDay }),
        ...(dto.payMultiplier !== undefined && { payMultiplier: dto.payMultiplier.toFixed(2) }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async removeCalendarEntry(id: string, tenantId: string) {
    const existing = await (this.prisma as any).hrWorkCalendar.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Work calendar entry ${id} not found`);
    return (this.prisma as any).hrWorkCalendar.delete({ where: { id } });
  }
}
