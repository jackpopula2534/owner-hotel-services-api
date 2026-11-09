import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import { HrLifecycleAssignmentService } from './hr-lifecycle-assignment.service';
import {
  CreateHrEmployeeDocumentDto,
  UpdateHrEmployeeDocumentDto,
} from './dto/hr-employee-document.dto';

/**
 * Employee document repository (P2-01): file metadata, expiry tracking,
 * access level, soft-delete, audit trail.
 */
@Injectable()
export class HrEmployeeDocumentService {
  private readonly logger = new Logger(HrEmployeeDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly hrLifecycleAssignmentService: HrLifecycleAssignmentService,
  ) {}

  private toDateOnly(value?: string): Date | null {
    if (!value) return null;
    const d = new Date(value);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  async findAll(query: Record<string, string>, tenantId: string) {
    const { employeeId, type, expiringInDays } = query;
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (employeeId) where['employeeId'] = employeeId;
    if (type) where['type'] = type;
    if (expiringInDays) {
      const until = new Date();
      until.setDate(until.getDate() + parseInt(expiringInDays, 10));
      where['expiresAt'] = { not: null, lte: until };
    }
    const data = await (this.prisma as any).hrEmployeeDocument.findMany({
      where,
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const doc = await (this.prisma as any).hrEmployeeDocument.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async create(dto: CreateHrEmployeeDocumentDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const [configuredType, configuredTypeCount] = await Promise.all([
      (this.prisma as any).hrDocumentType.findFirst({
        where: { tenantId, code: dto.type, isActive: true },
      }),
      (this.prisma as any).hrDocumentType.count({ where: { tenantId } }),
    ]);
    if (configuredTypeCount > 0 && !configuredType) {
      throw new NotFoundException(`Configured document type ${dto.type} not found`);
    }

    const doc = await (this.prisma as any).hrEmployeeDocument.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        type: dto.type,
        name: dto.name,
        fileUrl: dto.fileUrl,
        fileName: dto.fileName ?? null,
        mimeType: dto.mimeType ?? null,
        fileSize: dto.fileSize ?? null,
        issuedAt: this.toDateOnly(dto.issuedAt),
        expiresAt: this.toDateOnly(dto.expiresAt),
        accessLevel: dto.accessLevel ?? configuredType?.accessLevel ?? 'hr',
        note: dto.note ?? null,
        uploadedBy: userId ?? null,
      },
    });

    await this.audit(AuditAction.EMPLOYEE_DOCUMENT_UPLOAD, doc.id, tenantId, userId, {
      employeeId: dto.employeeId,
      type: dto.type,
    });
    await this.hrLifecycleAssignmentService
      .syncRequirementForUploadedDocument(doc.id, tenantId)
      .catch((err) => this.logger.warn(`Requirement sync failed after upload: ${err.message}`));
    return doc;
  }

  async update(id: string, dto: UpdateHrEmployeeDocumentDto, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrEmployeeDocument.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.issuedAt !== undefined && { issuedAt: this.toDateOnly(dto.issuedAt) }),
        ...(dto.expiresAt !== undefined && { expiresAt: this.toDateOnly(dto.expiresAt) }),
        ...(dto.accessLevel !== undefined && { accessLevel: dto.accessLevel }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async remove(id: string, tenantId: string, userId?: string) {
    await this.findOne(id, tenantId);
    const doc = await (this.prisma as any).hrEmployeeDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.hrLifecycleAssignmentService
      .revertRequirementForRemovedDocument(id, tenantId)
      .catch((err) => this.logger.warn(`Requirement revert failed after delete: ${err.message}`));
    await this.audit(AuditAction.EMPLOYEE_DOCUMENT_DELETE, id, tenantId, userId, {});
    return doc;
  }

  private async audit(
    action: AuditAction,
    resourceId: string,
    tenantId: string,
    userId: string | undefined,
    newValues: Record<string, unknown>,
  ) {
    await this.auditLog
      .log({
        action,
        resource: AuditResource.EMPLOYEE_DOCUMENT,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description: 'Employee document change',
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }
}
