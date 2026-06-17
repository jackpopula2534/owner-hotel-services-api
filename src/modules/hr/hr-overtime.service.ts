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
  CreateHrOvertimeRequestDto,
  ReviewHrOvertimeRequestDto,
} from './dto/create-hr-overtime-request.dto';

export interface BulkOvertimeResult {
  created: number;
  skipped: number;
  skippedEmployeeIds: string[];
}

/**
 * Overtime approval workflow (P1-05). Approved OT is the source of truth the
 * payroll engine uses when a policy sets otRequiresApproval = true.
 */
@Injectable()
export class HrOvertimeService {
  private readonly logger = new Logger(HrOvertimeService.name);

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
    const { employeeId, status, dateFrom, dateTo } = query;

    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (status) where['status'] = status;
    if (dateFrom || dateTo) {
      where['date'] = {
        ...(dateFrom && { gte: this.toDateOnly(dateFrom) }),
        ...(dateTo && { lte: this.toDateOnly(dateTo) }),
      };
    }

    const [data, total] = await Promise.all([
      (this.prisma as any).hrOvertimeRequest.findMany({
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
      (this.prisma as any).hrOvertimeRequest.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const record = await (this.prisma as any).hrOvertimeRequest.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    if (!record) throw new NotFoundException(`Overtime request ${id} not found`);
    return record;
  }

  async create(dto: CreateHrOvertimeRequestDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const record = await (this.prisma as any).hrOvertimeRequest.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        attendanceId: dto.attendanceId ?? null,
        date: this.toDateOnly(dto.date),
        minutes: dto.minutes,
        multiplier: (dto.multiplier ?? 1.5).toFixed(2),
        reason: dto.reason ?? null,
        status: 'pending',
        createdBy: userId ?? null,
      },
    });

    await this.auditLog
      .log({
        action: AuditAction.OVERTIME_REQUEST,
        resource: AuditResource.OVERTIME_REQUEST,
        resourceId: record.id,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues: { employeeId: dto.employeeId, minutes: dto.minutes, date: dto.date },
        description: `Overtime requested (${dto.minutes} min)`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    return record;
  }

  /**
   * สร้างคำขอ OT หลายรายการพร้อมกัน (เช่น ขอ OT ทั้งแผนก → ขยายเป็นรายคนจากฝั่ง client).
   * ตรวจสอบว่าพนักงานทุกคนอยู่ใน tenant เดียวกัน แล้วบันทึกด้วย createMany.
   */
  async createBulk(
    dtos: CreateHrOvertimeRequestDto[],
    tenantId: string,
    userId?: string,
  ): Promise<BulkOvertimeResult> {
    if (!dtos.length) {
      throw new BadRequestException('No overtime requests provided');
    }

    const employeeIds = [...new Set(dtos.map((d) => d.employeeId))];
    const employees = await (this.prisma.employee as any).findMany({
      where: { id: { in: employeeIds }, tenantId },
      select: { id: true },
    });
    const validIds = new Set<string>(employees.map((e: any) => e.id));

    const accepted = dtos.filter((d) => validIds.has(d.employeeId));
    const skippedEmployeeIds = dtos
      .filter((d) => !validIds.has(d.employeeId))
      .map((d) => d.employeeId);

    if (!accepted.length) {
      throw new NotFoundException('No valid employees found for this tenant');
    }

    const data = accepted.map((d) => ({
      tenantId,
      employeeId: d.employeeId,
      attendanceId: d.attendanceId ?? null,
      date: this.toDateOnly(d.date),
      minutes: d.minutes,
      multiplier: (d.multiplier ?? 1.5).toFixed(2),
      reason: d.reason ?? null,
      status: 'pending',
      createdBy: userId ?? null,
    }));

    const result = await (this.prisma as any).hrOvertimeRequest.createMany({ data });

    await this.auditLog
      .log({
        action: AuditAction.OVERTIME_REQUEST,
        resource: AuditResource.OVERTIME_REQUEST,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues: { count: result.count, employeeIds: accepted.map((d) => d.employeeId) },
        description: `Bulk overtime requested (${result.count} employees)`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(
      `Bulk OT created: ${result.count} request(s), ${skippedEmployeeIds.length} skipped (tenant ${tenantId})`,
    );

    return {
      created: result.count,
      skipped: skippedEmployeeIds.length,
      skippedEmployeeIds,
    };
  }

  async review(
    id: string,
    dto: ReviewHrOvertimeRequestDto,
    reviewerId: string,
    tenantId: string,
  ) {
    const request = await this.findOne(id, tenantId);
    if (request.status !== 'pending') {
      throw new BadRequestException(`Overtime request is already ${request.status}`);
    }

    const approved = dto.status === 'approved';
    const updated = await (this.prisma as any).hrOvertimeRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote ?? null,
        ...(approved
          ? { approvedBy: reviewerId, approvedAt: new Date() }
          : { rejectedBy: reviewerId, rejectedAt: new Date() }),
      },
    });

    await this.auditLog
      .log({
        action: approved ? AuditAction.OVERTIME_APPROVE : AuditAction.OVERTIME_REJECT,
        resource: AuditResource.OVERTIME_REQUEST,
        resourceId: id,
        category: AuditCategory.HR,
        tenantId,
        userId: reviewerId,
        oldValues: { status: 'pending' },
        newValues: { status: dto.status },
        description: `Overtime request ${dto.status}`,
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));

    this.logger.log(`Overtime request ${id} ${dto.status} by ${reviewerId}`);
    return updated;
  }
}
