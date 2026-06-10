import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource, AuditCategory } from '../../audit-log/dto/audit-log.dto';
import {
  SeedOnboardingDto,
  AddOnboardingTaskDto,
  UpdateOnboardingTaskDto,
} from './dto/hr-lifecycle.dto';

/**
 * Onboarding checklist (P2-03). Seeds a default template per new employee and
 * tracks completion of document/account/training/equipment tasks.
 */
@Injectable()
export class HrOnboardingService {
  private readonly logger = new Logger(HrOnboardingService.name);

  static readonly DEFAULT_TEMPLATE: { title: string; category: string }[] = [
    { title: 'เก็บสำเนาบัตรประชาชน/ทะเบียนบ้าน', category: 'document' },
    { title: 'เซ็นสัญญาจ้าง', category: 'document' },
    { title: 'ลงนาม PDPA consent', category: 'document' },
    { title: 'เปิดบัญชีผู้ใช้ระบบ', category: 'account' },
    { title: 'มอบหมายแผนก/ตำแหน่ง/กะ', category: 'account' },
    { title: 'อบรมความปลอดภัย/ปฐมนิเทศ', category: 'training' },
    { title: 'จัดเตรียมอุปกรณ์/ยูนิฟอร์ม', category: 'equipment' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findByEmployee(employeeId: string, tenantId: string) {
    const data = await (this.prisma as any).hrOnboardingTask.findMany({
      where: { tenantId, employeeId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const completed = data.filter((t: any) => t.isComplete).length;
    return { data, total: data.length, completed, progress: data.length ? completed / data.length : 0 };
  }

  async seed(dto: SeedOnboardingDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const items =
      dto.tasks && dto.tasks.length
        ? dto.tasks
        : HrOnboardingService.DEFAULT_TEMPLATE.map((t) => ({ ...t }));

    await (this.prisma as any).hrOnboardingTask.createMany({
      data: items.map((t: any, idx: number) => ({
        tenantId,
        employeeId: dto.employeeId,
        title: t.title,
        category: t.category ?? 'general',
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        sortOrder: t.sortOrder ?? idx,
        note: t.note ?? null,
      })),
    });

    await this.audit(dto.employeeId, tenantId, userId, { action: 'seed', count: items.length });
    return this.findByEmployee(dto.employeeId, tenantId);
  }

  async addTask(dto: AddOnboardingTaskDto, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);
    return (this.prisma as any).hrOnboardingTask.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        title: dto.title,
        category: dto.category ?? 'general',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        sortOrder: dto.sortOrder ?? 0,
        note: dto.note ?? null,
      },
    });
  }

  async updateTask(id: string, dto: UpdateOnboardingTaskDto, tenantId: string, userId?: string) {
    const existing = await (this.prisma as any).hrOnboardingTask.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Onboarding task ${id} not found`);
    const updated = await (this.prisma as any).hrOnboardingTask.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.isComplete !== undefined && {
          isComplete: dto.isComplete,
          completedAt: dto.isComplete ? new Date() : null,
          completedBy: dto.isComplete ? userId ?? null : null,
        }),
      },
    });
    if (dto.isComplete !== undefined) {
      await this.audit(existing.employeeId, tenantId, userId, {
        action: 'task_update',
        taskId: id,
        isComplete: dto.isComplete,
      });
    }
    return updated;
  }

  async removeTask(id: string, tenantId: string) {
    const existing = await (this.prisma as any).hrOnboardingTask.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(`Onboarding task ${id} not found`);
    return (this.prisma as any).hrOnboardingTask.delete({ where: { id } });
  }

  private async audit(
    employeeId: string,
    tenantId: string,
    userId: string | undefined,
    newValues: Record<string, unknown>,
  ) {
    await this.auditLog
      .log({
        action: AuditAction.ONBOARDING_UPDATE,
        resource: AuditResource.ONBOARDING,
        resourceId: employeeId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description: 'Onboarding checklist change',
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }
}
