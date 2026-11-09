import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  CreateHrTrainingRecordDto,
  UpdateHrTrainingRecordDto,
} from './dto/hr-training.dto';

/** Training & certification tracking (P3-03). */
@Injectable()
export class HrTrainingService {
  private readonly logger = new Logger(HrTrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private toDateOnly(v?: string): Date | null {
    if (!v) return null;
    const d = new Date(v);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const { employeeId, type, status, expiringInDays } = query;
    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;
    if (type) where['type'] = type;
    if (status) where['status'] = status;
    if (expiringInDays) {
      const until = new Date();
      until.setDate(until.getDate() + parseInt(expiringInDays, 10));
      where['expiresAt'] = { not: null, lte: until };
    }
    const data = await (this.prisma as any).hrTrainingRecord.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const rec = await (this.prisma as any).hrTrainingRecord.findFirst({ where: { id, tenantId } });
    if (!rec) throw new NotFoundException(`Training record ${id} not found`);
    return rec;
  }

  async create(dto: CreateHrTrainingRecordDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const rec = await (this.prisma as any).hrTrainingRecord.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        title: dto.title,
        type: dto.type ?? 'training',
        provider: dto.provider ?? null,
        status: dto.status ?? 'planned',
        completedAt: this.toDateOnly(dto.completedAt),
        expiresAt: this.toDateOnly(dto.expiresAt),
        score: dto.score !== undefined ? dto.score.toFixed(2) : null,
        certificateUrl: dto.certificateUrl ?? null,
        note: dto.note ?? null,
      },
    });
    await this.audit(rec.id, tenantId, userId, { action: 'create', title: dto.title });
    return rec;
  }

  async update(id: string, dto: UpdateHrTrainingRecordDto, tenantId: string, userId?: string) {
    await this.findOne(id, tenantId);
    const rec = await (this.prisma as any).hrTrainingRecord.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.provider !== undefined && { provider: dto.provider }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.completedAt !== undefined && { completedAt: this.toDateOnly(dto.completedAt) }),
        ...(dto.expiresAt !== undefined && { expiresAt: this.toDateOnly(dto.expiresAt) }),
        ...(dto.score !== undefined && { score: dto.score.toFixed(2) }),
        ...(dto.certificateUrl !== undefined && { certificateUrl: dto.certificateUrl }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
    await this.audit(id, tenantId, userId, { action: 'update' });
    return rec;
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrTrainingRecord.delete({ where: { id } });
  }

  private async audit(
    resourceId: string,
    tenantId: string,
    userId: string | undefined,
    newValues: Record<string, unknown>,
  ) {
    await this.auditLog
      .log({
        action: AuditAction.TRAINING_RECORD_UPDATE,
        resource: AuditResource.TRAINING_RECORD,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description: 'Training record change',
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }
}
