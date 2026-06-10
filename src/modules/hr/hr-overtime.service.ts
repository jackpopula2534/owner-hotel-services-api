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
