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

  /**
   * Non-document onboarding tasks (account/training/equipment). Document tasks
   * are generated dynamically from the tenant's configured document types
   * (HrDocumentType) so the checklist always matches "ตั้งค่า HR Lifecycle ›
   * ประเภทเอกสาร". See {@link buildDefaultTasks}.
   */
  static readonly NON_DOCUMENT_TEMPLATE: { title: string; category: string }[] = [
    { title: 'เปิดบัญชีผู้ใช้ระบบ', category: 'account' },
    { title: 'มอบหมายแผนก/ตำแหน่ง/กะ', category: 'account' },
    { title: 'อบรมความปลอดภัย/ปฐมนิเทศ', category: 'training' },
    { title: 'จัดเตรียมอุปกรณ์/ยูนิฟอร์ม', category: 'equipment' },
  ];

  /** Fallback document tasks when the tenant has not configured any document types yet. */
  static readonly LEGACY_DOCUMENT_TEMPLATE: { title: string; category: string }[] = [
    { title: 'เก็บสำเนาบัตรประชาชน/ทะเบียนบ้าน', category: 'document' },
    { title: 'เซ็นสัญญาจ้าง', category: 'document' },
    { title: 'ลงนาม PDPA consent', category: 'document' },
  ];

  /** Backwards-compatible full default checklist (document + non-document). */
  static get DEFAULT_TEMPLATE(): { title: string; category: string }[] {
    return [
      ...HrOnboardingService.LEGACY_DOCUMENT_TEMPLATE,
      ...HrOnboardingService.NON_DOCUMENT_TEMPLATE,
    ];
  }

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

  /**
   * Build the default onboarding checklist for a tenant. Document-category tasks
   * are derived from the configured document types (HrDocumentType) — preferring
   * those marked `requiredByDefault` — so titles match the "ประเภทเอกสาร"
   * dropdown exactly. Non-document tasks come from {@link NON_DOCUMENT_TEMPLATE}.
   */
  private async buildDefaultTasks(
    tenantId: string,
  ): Promise<{ title: string; category: string }[]> {
    const docTypes = await (this.prisma as any).hrDocumentType.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const required = docTypes.filter((d: any) => d.requiredByDefault);
    const source = required.length ? required : docTypes;

    const documentTasks: { title: string; category: string }[] = source.map((d: any) => ({
      title: `เก็บเอกสาร: ${d.name}`,
      category: 'document',
    }));

    const docTasks = documentTasks.length
      ? documentTasks
      : HrOnboardingService.LEGACY_DOCUMENT_TEMPLATE.map((t) => ({ ...t }));

    return [...docTasks, ...HrOnboardingService.NON_DOCUMENT_TEMPLATE.map((t) => ({ ...t }))];
  }

  async seed(dto: SeedOnboardingDto, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${dto.employeeId} not found`);

    const items =
      dto.tasks && dto.tasks.length
        ? dto.tasks.map((t) => ({ ...t }))
        : await this.buildDefaultTasks(tenantId);

    // Idempotent: skip any task that already exists for this employee
    // (matched by category + title) so repeated "สร้าง Checklist" clicks never
    // produce "ซ้ำ 2" duplicates.
    const existing = await (this.prisma as any).hrOnboardingTask.findMany({
      where: { tenantId, employeeId: dto.employeeId },
      select: { title: true, category: true },
    });
    const existingKeys = new Set(
      existing.map((t: any) => `${t.category ?? 'general'}::${t.title}`),
    );

    const toCreate = items.filter(
      (t: any) => !existingKeys.has(`${t.category ?? 'general'}::${t.title}`),
    );

    if (toCreate.length) {
      await (this.prisma as any).hrOnboardingTask.createMany({
        data: toCreate.map((t: any, idx: number) => ({
          tenantId,
          employeeId: dto.employeeId,
          title: t.title,
          category: t.category ?? 'general',
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          sortOrder: t.sortOrder ?? existing.length + idx,
          note: t.note ?? null,
        })),
      });
    }

    await this.audit(dto.employeeId, tenantId, userId, {
      action: 'seed',
      created: toCreate.length,
      skipped: items.length - toCreate.length,
    });
    return this.findByEmployee(dto.employeeId, tenantId);
  }

  /**
   * Remove duplicate onboarding tasks (same category + title) for an employee,
   * keeping one per group. Prefers keeping a completed instance so progress is
   * preserved. Used by the "ล้างงานซ้ำ" action to clean up legacy duplicates.
   */
  async dedupe(employeeId: string, tenantId: string, userId?: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    const tasks = await (this.prisma as any).hrOnboardingTask.findMany({
      where: { tenantId, employeeId },
      // Completed first so the kept instance retains progress; then oldest first.
      orderBy: [{ isComplete: 'desc' }, { createdAt: 'asc' }],
    });

    const seen = new Set<string>();
    const removeIds: string[] = [];
    for (const t of tasks) {
      const key = `${t.category ?? 'general'}::${t.title}`;
      if (seen.has(key)) removeIds.push(t.id);
      else seen.add(key);
    }

    if (removeIds.length) {
      await (this.prisma as any).hrOnboardingTask.deleteMany({
        where: { id: { in: removeIds }, tenantId },
      });
      await this.audit(employeeId, tenantId, userId, {
        action: 'dedupe',
        removed: removeIds.length,
      });
    }

    return this.findByEmployee(employeeId, tenantId);
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
