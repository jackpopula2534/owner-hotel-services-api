import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHrDocumentTypeDto,
  CreateHrLifecycleAssignmentRuleDto,
  CreateHrLifecyclePackageDto,
  UpdateHrDocumentTypeDto,
  UpdateHrLifecycleAssignmentRuleDto,
  UpdateHrLifecyclePackageDto,
} from './dto/hr-lifecycle-setup.dto';

@Injectable()
export class HrLifecycleSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async listDocumentTypes(tenantId: string, query: Record<string, string>) {
    const where: Record<string, unknown> = { tenantId };
    if (query.activeOnly === 'true') where['isActive'] = true;
    if (query.category) where['category'] = query.category;
    const data = await (this.prisma as any).hrDocumentType.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { data, total: data.length };
  }

  async getDocumentType(id: string, tenantId: string) {
    const item = await (this.prisma as any).hrDocumentType.findFirst({
      where: { id, tenantId },
    });
    if (!item) throw new NotFoundException(`Document type ${id} not found`);
    return item;
  }

  async createDocumentType(dto: CreateHrDocumentTypeDto, tenantId: string) {
    const existing = await (this.prisma as any).hrDocumentType.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Document type code ${dto.code} already exists`);
    return (this.prisma as any).hrDocumentType.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        category: dto.category ?? 'general',
        description: dto.description ?? null,
        requiredByDefault: dto.requiredByDefault ?? false,
        hasExpiry: dto.hasExpiry ?? false,
        expiryPolicyDays: dto.expiryPolicyDays ?? null,
        accessLevel: dto.accessLevel ?? 'hr',
        requiresVerification: dto.requiresVerification ?? false,
        allowedFileTypes: dto.allowedFileTypes ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateDocumentType(id: string, dto: UpdateHrDocumentTypeDto, tenantId: string) {
    await this.getDocumentType(id, tenantId);
    if (dto.code) {
      const existing = await (this.prisma as any).hrDocumentType.findFirst({
        where: { tenantId, code: dto.code, id: { not: id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException(`Document type code ${dto.code} already exists`);
    }
    return (this.prisma as any).hrDocumentType.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.requiredByDefault !== undefined && { requiredByDefault: dto.requiredByDefault }),
        ...(dto.hasExpiry !== undefined && { hasExpiry: dto.hasExpiry }),
        ...(dto.expiryPolicyDays !== undefined && { expiryPolicyDays: dto.expiryPolicyDays }),
        ...(dto.accessLevel !== undefined && { accessLevel: dto.accessLevel }),
        ...(dto.requiresVerification !== undefined && { requiresVerification: dto.requiresVerification }),
        ...(dto.allowedFileTypes !== undefined && { allowedFileTypes: dto.allowedFileTypes }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteDocumentType(id: string, tenantId: string) {
    await this.getDocumentType(id, tenantId);
    const usage = await Promise.all([
      (this.prisma as any).hrLifecyclePackageDocument.count({ where: { documentTypeId: id } }),
      (this.prisma as any).hrEmployeeDocumentRequirement.count({ where: { documentTypeId: id } }),
    ]);
    if (usage.some((count) => count > 0)) {
      throw new BadRequestException('Document type is in use and cannot be deleted');
    }
    await (this.prisma as any).hrDocumentType.delete({ where: { id } });
    return { success: true };
  }

  async listPackages(tenantId: string, query: Record<string, string>) {
    const where: Record<string, unknown> = { tenantId };
    if (query.lifecycleType) where['lifecycleType'] = query.lifecycleType;
    if (query.activeOnly === 'true') where['isActive'] = true;
    const data = await (this.prisma as any).hrLifecyclePackage.findMany({
      where,
      include: {
        documents: {
          include: { documentType: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        assignmentRules: true,
      },
      orderBy: [{ lifecycleType: 'asc' }, { name: 'asc' }],
    });
    return { data, total: data.length };
  }

  async getPackage(id: string, tenantId: string) {
    const item = await (this.prisma as any).hrLifecyclePackage.findFirst({
      where: { id, tenantId },
      include: {
        documents: {
          include: { documentType: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        assignmentRules: {
          include: { property: true, department: true, position: true },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!item) throw new NotFoundException(`Lifecycle package ${id} not found`);
    return item;
  }

  private async validateDocumentTypes(ids: string[], tenantId: string) {
    if (ids.length === 0) return;
    const count = await (this.prisma as any).hrDocumentType.count({
      where: { tenantId, id: { in: ids } },
    });
    if (count !== ids.length) throw new NotFoundException('One or more document types not found');
  }

  async createPackage(dto: CreateHrLifecyclePackageDto, tenantId: string) {
    const existing = await (this.prisma as any).hrLifecyclePackage.findFirst({
      where: { tenantId, code: dto.code },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Lifecycle package code ${dto.code} already exists`);
    await this.validateDocumentTypes((dto.documents ?? []).map((item) => item.documentTypeId), tenantId);
    return this.prisma.$transaction(async (tx) => {
      const created = await (tx as any).hrLifecyclePackage.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          lifecycleType: dto.lifecycleType ?? 'onboarding',
          description: dto.description ?? null,
          isActive: dto.isActive ?? true,
        },
      });

      if (dto.documents?.length) {
        await (tx as any).hrLifecyclePackageDocument.createMany({
          data: dto.documents.map((item, index) => ({
            packageId: created.id,
            documentTypeId: item.documentTypeId,
            isRequired: item.isRequired ?? true,
            dueOffsetDays: item.dueOffsetDays ?? null,
            ruleNote: item.ruleNote ?? null,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }

      if (dto.tasks?.length) {
        await (tx as any).hrLifecyclePackageTask.createMany({
          data: dto.tasks.map((item, index) => ({
            packageId: created.id,
            title: item.title,
            category: item.category ?? 'general',
            ownerRole: item.ownerRole ?? null,
            dueOffsetDays: item.dueOffsetDays ?? null,
            sortOrder: item.sortOrder ?? index,
            requiresApproval: item.requiresApproval ?? false,
            note: item.note ?? null,
          })),
        });
      }

      return (tx as any).hrLifecyclePackage.findUnique({
        where: { id: created.id },
        include: {
          documents: { include: { documentType: true }, orderBy: { sortOrder: 'asc' } },
          tasks: { orderBy: { sortOrder: 'asc' } },
        },
      });
    });
  }

  async updatePackage(id: string, dto: UpdateHrLifecyclePackageDto, tenantId: string) {
    await this.getPackage(id, tenantId);
    if (dto.code) {
      const existing = await (this.prisma as any).hrLifecyclePackage.findFirst({
        where: { tenantId, code: dto.code, id: { not: id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException(`Lifecycle package code ${dto.code} already exists`);
    }
    await this.validateDocumentTypes((dto.documents ?? []).map((item) => item.documentTypeId), tenantId);

    return this.prisma.$transaction(async (tx) => {
      await (tx as any).hrLifecyclePackage.update({
        where: { id },
        data: {
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.lifecycleType !== undefined && { lifecycleType: dto.lifecycleType }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      if (dto.documents) {
        await (tx as any).hrLifecyclePackageDocument.deleteMany({ where: { packageId: id } });
        if (dto.documents.length) {
          await (tx as any).hrLifecyclePackageDocument.createMany({
            data: dto.documents.map((item, index) => ({
              packageId: id,
              documentTypeId: item.documentTypeId,
              isRequired: item.isRequired ?? true,
              dueOffsetDays: item.dueOffsetDays ?? null,
              ruleNote: item.ruleNote ?? null,
              sortOrder: item.sortOrder ?? index,
            })),
          });
        }
      }

      if (dto.tasks) {
        await (tx as any).hrLifecyclePackageTask.deleteMany({ where: { packageId: id } });
        if (dto.tasks.length) {
          await (tx as any).hrLifecyclePackageTask.createMany({
            data: dto.tasks.map((item, index) => ({
              packageId: id,
              title: item.title,
              category: item.category ?? 'general',
              ownerRole: item.ownerRole ?? null,
              dueOffsetDays: item.dueOffsetDays ?? null,
              sortOrder: item.sortOrder ?? index,
              requiresApproval: item.requiresApproval ?? false,
              note: item.note ?? null,
            })),
          });
        }
      }

      return this.getPackage(id, tenantId);
    });
  }

  async deletePackage(id: string, tenantId: string) {
    await this.getPackage(id, tenantId);
    const activeAssignments = await (this.prisma as any).hrEmployeeLifecycleAssignment.count({
      where: { packageId: id, status: 'active' },
    });
    if (activeAssignments > 0) {
      throw new BadRequestException('Lifecycle package has active employee assignments and cannot be deleted');
    }
    await (this.prisma as any).hrLifecyclePackage.delete({ where: { id } });
    return { success: true };
  }

  async listRules(tenantId: string) {
    const data = await (this.prisma as any).hrLifecycleAssignmentRule.findMany({
      where: { tenantId },
      include: {
        package: true,
        property: true,
        department: true,
        position: true,
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return { data, total: data.length };
  }

  async getRule(id: string, tenantId: string) {
    const item = await (this.prisma as any).hrLifecycleAssignmentRule.findFirst({
      where: { id, tenantId },
      include: {
        package: true,
        property: true,
        department: true,
        position: true,
      },
    });
    if (!item) throw new NotFoundException(`Assignment rule ${id} not found`);
    return item;
  }

  private async validateRuleTargets(dto: CreateHrLifecycleAssignmentRuleDto | UpdateHrLifecycleAssignmentRuleDto, tenantId: string) {
    if (dto.packageId) {
      const exists = await (this.prisma as any).hrLifecyclePackage.findFirst({
        where: { id: dto.packageId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException(`Lifecycle package ${dto.packageId} not found`);
    }
    if (dto.propertyId) {
      const exists = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException(`Property ${dto.propertyId} not found`);
    }
    if (dto.departmentId) {
      const exists = await this.prisma.hrDepartment.findFirst({
        where: { id: dto.departmentId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException(`Department ${dto.departmentId} not found`);
    }
    if (dto.positionId) {
      const exists = await this.prisma.hrPosition.findFirst({
        where: { id: dto.positionId, tenantId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException(`Position ${dto.positionId} not found`);
    }
  }

  async createRule(dto: CreateHrLifecycleAssignmentRuleDto, tenantId: string) {
    await this.validateRuleTargets(dto, tenantId);
    return (this.prisma as any).hrLifecycleAssignmentRule.create({
      data: {
        tenantId,
        packageId: dto.packageId,
        propertyId: dto.propertyId ?? null,
        departmentId: dto.departmentId ?? null,
        positionId: dto.positionId ?? null,
        employmentType: dto.employmentType ?? null,
        priority: dto.priority ?? 100,
        isActive: dto.isActive ?? true,
      },
      include: {
        package: true,
        property: true,
        department: true,
        position: true,
      },
    });
  }

  async updateRule(id: string, dto: UpdateHrLifecycleAssignmentRuleDto, tenantId: string) {
    await this.getRule(id, tenantId);
    await this.validateRuleTargets(dto, tenantId);
    return (this.prisma as any).hrLifecycleAssignmentRule.update({
      where: { id },
      data: {
        ...(dto.packageId !== undefined && { packageId: dto.packageId }),
        ...(dto.propertyId !== undefined && { propertyId: dto.propertyId }),
        ...(dto.departmentId !== undefined && { departmentId: dto.departmentId }),
        ...(dto.positionId !== undefined && { positionId: dto.positionId }),
        ...(dto.employmentType !== undefined && { employmentType: dto.employmentType }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        package: true,
        property: true,
        department: true,
        position: true,
      },
    });
  }

  async deleteRule(id: string, tenantId: string) {
    await this.getRule(id, tenantId);
    await (this.prisma as any).hrLifecycleAssignmentRule.delete({ where: { id } });
    return { success: true };
  }

  // ─── Starter data seeding (idempotent) ──────────────────────────────────────
  // Creates the recommended hotel document types + lifecycle packages so a new
  // tenant can use the lifecycle engine without manual setup. Safe to run more
  // than once: existing codes are skipped, never overwritten.

  async seedStarterData(tenantId: string) {
    const docDefs: Array<{
      code: string;
      name: string;
      category: string;
      requiredByDefault?: boolean;
      hasExpiry?: boolean;
      expiryPolicyDays?: number | null;
      requiresVerification?: boolean;
      sortOrder: number;
    }> = [
      { code: 'id_card', name: 'บัตรประชาชน', category: 'identity', requiredByDefault: true, sortOrder: 1 },
      { code: 'passport', name: 'หนังสือเดินทาง', category: 'identity', hasExpiry: true, sortOrder: 2 },
      { code: 'contract', name: 'สัญญาจ้าง', category: 'employment', requiredByDefault: true, requiresVerification: true, sortOrder: 3 },
      { code: 'pdpa_consent', name: 'หนังสือยินยอม PDPA', category: 'compliance', sortOrder: 4 },
      { code: 'health_cert', name: 'ใบรับรองแพทย์', category: 'health', hasExpiry: true, expiryPolicyDays: 365, sortOrder: 5 },
      { code: 'visa', name: 'วีซ่า', category: 'immigration', hasExpiry: true, sortOrder: 6 },
      { code: 'work_permit', name: 'ใบอนุญาตทำงาน', category: 'immigration', hasExpiry: true, expiryPolicyDays: 365, requiresVerification: true, sortOrder: 7 },
      { code: 'food_safety_cert', name: 'ใบรับรองสุขอนามัยอาหาร', category: 'training', hasExpiry: true, expiryPolicyDays: 365, sortOrder: 8 },
    ];

    const codeToId = new Map<string, string>();
    let documentTypesCreated = 0;
    for (const def of docDefs) {
      let item = await (this.prisma as any).hrDocumentType.findFirst({
        where: { tenantId, code: def.code },
        select: { id: true },
      });
      if (!item) {
        item = await (this.prisma as any).hrDocumentType.create({
          data: {
            tenantId,
            code: def.code,
            name: def.name,
            category: def.category,
            requiredByDefault: def.requiredByDefault ?? false,
            hasExpiry: def.hasExpiry ?? false,
            expiryPolicyDays: def.expiryPolicyDays ?? null,
            accessLevel: 'hr',
            requiresVerification: def.requiresVerification ?? false,
            sortOrder: def.sortOrder,
            isActive: true,
          },
          select: { id: true },
        });
        documentTypesCreated++;
      }
      codeToId.set(def.code, item.id);
    }

    interface PkgDef {
      code: string;
      name: string;
      lifecycleType: string;
      documents: Array<{ code: string; isRequired?: boolean; dueOffsetDays?: number }>;
      tasks: Array<{ title: string; category: string; ownerRole?: string; dueOffsetDays?: number }>;
    }

    const pkgDefs: PkgDef[] = [
      {
        code: 'NEW_HIRE_FRONT_OFFICE',
        name: 'พนักงานใหม่ - Front Office',
        lifecycleType: 'onboarding',
        documents: [
          { code: 'id_card', isRequired: true, dueOffsetDays: 3 },
          { code: 'contract', isRequired: true, dueOffsetDays: 1 },
          { code: 'pdpa_consent', isRequired: true, dueOffsetDays: 3 },
        ],
        tasks: [
          { title: 'จัดเตรียมเครื่องแบบ', category: 'equipment', ownerRole: 'hr', dueOffsetDays: 1 },
          { title: 'สร้างบัญชีระบบ PMS', category: 'account', ownerRole: 'it', dueOffsetDays: 1 },
          { title: 'จัดกะการทำงาน', category: 'general', ownerRole: 'manager', dueOffsetDays: 2 },
          { title: 'อบรมมาตรฐานการบริการ', category: 'training', ownerRole: 'manager', dueOffsetDays: 7 },
        ],
      },
      {
        code: 'NEW_HIRE_HOUSEKEEPING',
        name: 'พนักงานใหม่ - แม่บ้าน',
        lifecycleType: 'onboarding',
        documents: [
          { code: 'id_card', isRequired: true, dueOffsetDays: 3 },
          { code: 'contract', isRequired: true, dueOffsetDays: 1 },
          { code: 'health_cert', isRequired: true, dueOffsetDays: 7 },
        ],
        tasks: [
          { title: 'จัดเตรียมเครื่องแบบ', category: 'equipment', ownerRole: 'hr', dueOffsetDays: 1 },
          { title: 'จัดเตรียมอุปกรณ์ทำความสะอาด', category: 'equipment', ownerRole: 'manager', dueOffsetDays: 1 },
          { title: 'อบรมความปลอดภัย', category: 'training', ownerRole: 'manager', dueOffsetDays: 3 },
          { title: 'อบรมมาตรฐานห้องพัก', category: 'training', ownerRole: 'manager', dueOffsetDays: 5 },
        ],
      },
      {
        code: 'NEW_HIRE_FNB',
        name: 'พนักงานใหม่ - อาหารและเครื่องดื่ม',
        lifecycleType: 'onboarding',
        documents: [
          { code: 'id_card', isRequired: true, dueOffsetDays: 3 },
          { code: 'contract', isRequired: true, dueOffsetDays: 1 },
          { code: 'health_cert', isRequired: true, dueOffsetDays: 7 },
          { code: 'food_safety_cert', isRequired: true, dueOffsetDays: 14 },
        ],
        tasks: [
          { title: 'สร้างบัญชีระบบ POS', category: 'account', ownerRole: 'it', dueOffsetDays: 1 },
          { title: 'จัดเตรียมเครื่องแบบ', category: 'equipment', ownerRole: 'hr', dueOffsetDays: 1 },
        ],
      },
      {
        code: 'FOREIGN_WORKER',
        name: 'แรงงานต่างชาติ',
        lifecycleType: 'compliance',
        documents: [
          { code: 'passport', isRequired: true, dueOffsetDays: 1 },
          { code: 'visa', isRequired: true, dueOffsetDays: 1 },
          { code: 'work_permit', isRequired: true, dueOffsetDays: 7 },
          { code: 'contract', isRequired: true, dueOffsetDays: 1 },
        ],
        tasks: [
          { title: 'ตรวจสอบเอกสารตามกฎหมายแรงงาน', category: 'document', ownerRole: 'hr', dueOffsetDays: 7 },
        ],
      },
      {
        code: 'OFFBOARDING_STANDARD',
        name: 'พ้นสภาพมาตรฐาน',
        lifecycleType: 'offboarding',
        documents: [],
        tasks: [
          { title: 'เพิกถอนสิทธิ์บัญชีระบบ', category: 'account', ownerRole: 'it' },
          { title: 'คืนเครื่องแบบ', category: 'equipment', ownerRole: 'hr' },
          { title: 'เคลียร์อุปกรณ์', category: 'equipment', ownerRole: 'manager' },
          { title: 'รวบรวมเอกสารชุดสุดท้าย', category: 'document', ownerRole: 'hr' },
          { title: 'เช็กลิสต์การลาออก', category: 'general', ownerRole: 'hr' },
        ],
      },
    ];

    let packagesCreated = 0;
    let packagesSkipped = 0;
    for (const def of pkgDefs) {
      const existing = await (this.prisma as any).hrLifecyclePackage.findFirst({
        where: { tenantId, code: def.code },
        select: { id: true },
      });
      if (existing) {
        packagesSkipped++;
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        const created = await (tx as any).hrLifecyclePackage.create({
          data: {
            tenantId,
            code: def.code,
            name: def.name,
            lifecycleType: def.lifecycleType,
            isActive: true,
          },
        });
        if (def.documents.length) {
          await (tx as any).hrLifecyclePackageDocument.createMany({
            data: def.documents.map((doc, index) => ({
              packageId: created.id,
              documentTypeId: codeToId.get(doc.code)!,
              isRequired: doc.isRequired ?? true,
              dueOffsetDays: doc.dueOffsetDays ?? null,
              sortOrder: index,
            })),
          });
        }
        if (def.tasks.length) {
          await (tx as any).hrLifecyclePackageTask.createMany({
            data: def.tasks.map((task, index) => ({
              packageId: created.id,
              title: task.title,
              category: task.category,
              ownerRole: task.ownerRole ?? null,
              dueOffsetDays: task.dueOffsetDays ?? null,
              sortOrder: index,
              requiresApproval: false,
            })),
          });
        }
      });
      packagesCreated++;
    }

    return {
      documentTypesCreated,
      documentTypesTotal: docDefs.length,
      packagesCreated,
      packagesSkipped,
    };
  }
}
