import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class HrLifecycleAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveDueDate(startDate: Date | null | undefined, dueOffsetDays?: number | null) {
    if (dueOffsetDays === undefined || dueOffsetDays === null) return null;
    const base = startDate ? new Date(startDate) : new Date();
    base.setDate(base.getDate() + dueOffsetDays);
    base.setHours(0, 0, 0, 0);
    return base;
  }

  private matchesRule(employee: any, rule: any) {
    if (rule.propertyId && employee.propertyId !== rule.propertyId) return false;
    if (rule.departmentId && employee.departmentId !== rule.departmentId) return false;
    if (rule.positionId && employee.positionId !== rule.positionId) return false;
    if (rule.employmentType && employee.employmentType !== rule.employmentType) return false;
    return true;
  }

  private async findEmployee(employeeId: string, tenantId: string) {
    const employee = await (this.prisma.employee as any).findFirst({
      where: { id: employeeId, tenantId },
      include: {
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);
    return employee;
  }

  async recomputeForEmployee(employeeId: string, tenantId: string, userId?: string) {
    const employee = await this.findEmployee(employeeId, tenantId);
    const [rules, defaultDocumentTypes, activeAssignments] = await Promise.all([
      (this.prisma as any).hrLifecycleAssignmentRule.findMany({
        where: { tenantId, isActive: true },
        include: {
          package: {
            include: {
              documents: {
                include: { documentType: true },
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              },
              tasks: {
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      (this.prisma as any).hrDocumentType.findMany({
        where: { tenantId, requiredByDefault: true, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      (this.prisma as any).hrEmployeeLifecycleAssignment.findMany({
        where: { tenantId, employeeId, status: 'active' },
      }),
    ]);

    const matchedRules = rules.filter((rule: any) => this.matchesRule(employee, rule));
    const activeAssignmentMap = new Map(activeAssignments.map((item: any) => [item.packageId, item]));

    let createdAssignments = 0;
    let createdRequirements = 0;
    let createdTasks = 0;

    const assignmentsToUse: any[] = [...activeAssignments];

    for (const rule of matchedRules) {
      const existingAssignment = activeAssignmentMap.get(rule.packageId);
      if (existingAssignment) continue;
      const assignment = await (this.prisma as any).hrEmployeeLifecycleAssignment.create({
        data: {
          tenantId,
          employeeId,
          packageId: rule.packageId,
          sourceRuleId: rule.id,
          assignedBy: userId ?? null,
          status: 'active',
        },
      });
      assignmentsToUse.push(assignment);
      activeAssignmentMap.set(rule.packageId, assignment);
      createdAssignments++;
    }

    const existingRequirements = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where: { tenantId, employeeId },
    });
    const existingRequirementKeys = new Set(
      existingRequirements.map((item: any) => `${item.documentTypeId}:${item.packageId ?? 'default'}`),
    );

    for (const documentType of defaultDocumentTypes) {
      const key = `${documentType.id}:default`;
      if (existingRequirementKeys.has(key)) continue;
      const matchingDocument = employee.documents.find((doc: any) => doc.type === documentType.code);
      await (this.prisma as any).hrEmployeeDocumentRequirement.create({
        data: {
          tenantId,
          employeeId,
          documentTypeId: documentType.id,
          status: matchingDocument ? 'uploaded' : 'missing',
          uploadedDocumentId: matchingDocument?.id ?? null,
        },
      });
      existingRequirementKeys.add(key);
      createdRequirements++;
    }

    for (const assignment of assignmentsToUse) {
      const pkg = matchedRules.find((rule: any) => rule.packageId === assignment.packageId)?.package
        ?? await (this.prisma as any).hrLifecyclePackage.findUnique({
          where: { id: assignment.packageId },
          include: {
            documents: { include: { documentType: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
          },
        });

      for (const pkgDoc of pkg.documents ?? []) {
        const key = `${pkgDoc.documentTypeId}:${assignment.packageId}`;
        if (existingRequirementKeys.has(key)) continue;
        const matchingDocument = employee.documents.find((doc: any) => doc.type === pkgDoc.documentType.code);
        await (this.prisma as any).hrEmployeeDocumentRequirement.create({
          data: {
            tenantId,
            employeeId,
            documentTypeId: pkgDoc.documentTypeId,
            packageId: assignment.packageId,
            assignmentId: assignment.id,
            status: matchingDocument ? 'uploaded' : 'missing',
            dueDate: this.resolveDueDate(employee.startDate, pkgDoc.dueOffsetDays),
            uploadedDocumentId: matchingDocument?.id ?? null,
          },
        });
        existingRequirementKeys.add(key);
        createdRequirements++;
      }

      for (const pkgTask of pkg.tasks ?? []) {
        const exists = await (this.prisma as any).hrOnboardingTask.findFirst({
          where: {
            tenantId,
            employeeId,
            title: pkgTask.title,
            category: pkgTask.category ?? 'general',
          },
          select: { id: true },
        });
        if (exists) continue;
        await (this.prisma as any).hrOnboardingTask.create({
          data: {
            tenantId,
            employeeId,
            title: pkgTask.title,
            category: pkgTask.category ?? 'general',
            dueDate: this.resolveDueDate(employee.startDate, pkgTask.dueOffsetDays),
            sortOrder: pkgTask.sortOrder ?? 0,
            note: pkgTask.note ?? null,
          },
        });
        createdTasks++;
      }
    }

    return {
      employeeId,
      matchedRuleIds: matchedRules.map((rule: any) => rule.id),
      createdAssignments,
      createdRequirements,
      createdTasks,
      activeAssignments: assignmentsToUse.length,
    };
  }

  async getRequirements(employeeId: string, tenantId: string) {
    await this.findEmployee(employeeId, tenantId);
    const data = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where: { tenantId, employeeId },
      include: {
        documentType: true,
        package: true,
        uploadedDocument: true,
      },
      orderBy: [
        { status: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    const summary = {
      total: data.length,
      missing: data.filter((item: any) => item.status === 'missing').length,
      uploaded: data.filter((item: any) => item.status === 'uploaded').length,
      verified: data.filter((item: any) => item.status === 'verified').length,
      expiringSoon: data.filter((item: any) => {
        if (!item.uploadedDocument?.expiresAt) return false;
        const until = new Date(item.uploadedDocument.expiresAt);
        const now = new Date();
        const diffDays = Math.ceil((until.getTime() - now.getTime()) / 86400000);
        return diffDays >= 0 && diffDays <= 30;
      }).length,
    };
    return { data, summary };
  }

  // ─── Requirement status transitions ────────────────────────────────────────

  async verifyRequirement(requirementId: string, tenantId: string, userId?: string) {
    const requirement = await (this.prisma as any).hrEmployeeDocumentRequirement.findFirst({
      where: { id: requirementId, tenantId },
    });
    if (!requirement) throw new NotFoundException(`Requirement ${requirementId} not found`);
    if (!requirement.uploadedDocumentId) {
      throw new BadRequestException('ต้องอัปโหลดเอกสารก่อนจึงจะตรวจสอบได้');
    }
    return (this.prisma as any).hrEmployeeDocumentRequirement.update({
      where: { id: requirementId },
      data: {
        status: 'verified',
        verifiedBy: userId ?? null,
        verifiedAt: new Date(),
        waivedReason: null,
      },
    });
  }

  async waiveRequirement(requirementId: string, tenantId: string, reason?: string) {
    const requirement = await (this.prisma as any).hrEmployeeDocumentRequirement.findFirst({
      where: { id: requirementId, tenantId },
    });
    if (!requirement) throw new NotFoundException(`Requirement ${requirementId} not found`);
    return (this.prisma as any).hrEmployeeDocumentRequirement.update({
      where: { id: requirementId },
      data: {
        status: 'waived',
        waivedReason: reason ?? null,
        verifiedBy: null,
        verifiedAt: null,
      },
    });
  }

  async bulkVerifyRequirements(ids: string[], tenantId: string, userId?: string) {
    if (!ids?.length) throw new BadRequestException('ต้องระบุ requirement อย่างน้อย 1 รายการ');
    // Only verify requirements that actually have an uploaded document.
    const verifiable = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where: { tenantId, id: { in: ids }, uploadedDocumentId: { not: null } },
      select: { id: true },
    });
    const verifiableIds = verifiable.map((r: any) => r.id);
    if (verifiableIds.length) {
      await (this.prisma as any).hrEmployeeDocumentRequirement.updateMany({
        where: { id: { in: verifiableIds } },
        data: { status: 'verified', verifiedBy: userId ?? null, verifiedAt: new Date(), waivedReason: null },
      });
    }
    return {
      requested: ids.length,
      verified: verifiableIds.length,
      skipped: ids.length - verifiableIds.length,
    };
  }

  // ─── Bulk package assignment ────────────────────────────────────────────────

  private async applyPackageToEmployee(employee: any, pkg: any, tenantId: string, userId?: string) {
    let assignment = await (this.prisma as any).hrEmployeeLifecycleAssignment.findFirst({
      where: { tenantId, employeeId: employee.id, packageId: pkg.id, status: 'active' },
    });
    let createdAssignment = false;
    if (!assignment) {
      assignment = await (this.prisma as any).hrEmployeeLifecycleAssignment.create({
        data: {
          tenantId,
          employeeId: employee.id,
          packageId: pkg.id,
          assignedBy: userId ?? null,
          status: 'active',
        },
      });
      createdAssignment = true;
    }

    const existing = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where: { tenantId, employeeId: employee.id },
    });
    const keys = new Set(existing.map((i: any) => `${i.documentTypeId}:${i.packageId ?? 'default'}`));

    let createdRequirements = 0;
    let createdTasks = 0;

    for (const pkgDoc of pkg.documents ?? []) {
      const key = `${pkgDoc.documentTypeId}:${pkg.id}`;
      if (keys.has(key)) continue;
      const match = (employee.documents ?? []).find((d: any) => d.type === pkgDoc.documentType.code);
      await (this.prisma as any).hrEmployeeDocumentRequirement.create({
        data: {
          tenantId,
          employeeId: employee.id,
          documentTypeId: pkgDoc.documentTypeId,
          packageId: pkg.id,
          assignmentId: assignment.id,
          status: match ? 'uploaded' : 'missing',
          dueDate: this.resolveDueDate(employee.startDate, pkgDoc.dueOffsetDays),
          uploadedDocumentId: match?.id ?? null,
        },
      });
      keys.add(key);
      createdRequirements++;
    }

    for (const pkgTask of pkg.tasks ?? []) {
      const exists = await (this.prisma as any).hrOnboardingTask.findFirst({
        where: {
          tenantId,
          employeeId: employee.id,
          title: pkgTask.title,
          category: pkgTask.category ?? 'general',
        },
        select: { id: true },
      });
      if (exists) continue;
      await (this.prisma as any).hrOnboardingTask.create({
        data: {
          tenantId,
          employeeId: employee.id,
          title: pkgTask.title,
          category: pkgTask.category ?? 'general',
          dueDate: this.resolveDueDate(employee.startDate, pkgTask.dueOffsetDays),
          sortOrder: pkgTask.sortOrder ?? 0,
          note: pkgTask.note ?? null,
        },
      });
      createdTasks++;
    }

    return { createdAssignment, createdRequirements, createdTasks };
  }

  async bulkAssignPackage(
    params: { employeeIds: string[]; packageId: string },
    tenantId: string,
    userId?: string,
  ) {
    const { employeeIds, packageId } = params;
    if (!employeeIds?.length) throw new BadRequestException('ต้องระบุพนักงานอย่างน้อย 1 คน');

    const pkg = await (this.prisma as any).hrLifecyclePackage.findFirst({
      where: { id: packageId, tenantId },
      include: {
        documents: { include: { documentType: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        tasks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!pkg) throw new NotFoundException(`Package ${packageId} not found`);

    let assignedEmployees = 0;
    let createdRequirements = 0;
    let createdTasks = 0;

    for (const employeeId of employeeIds) {
      const employee = await (this.prisma as any).employee.findFirst({
        where: { id: employeeId, tenantId },
        include: { documents: { where: { deletedAt: null } } },
      });
      if (!employee) continue;
      const res = await this.applyPackageToEmployee(employee, pkg, tenantId, userId);
      if (res.createdAssignment) assignedEmployees++;
      createdRequirements += res.createdRequirements;
      createdTasks += res.createdTasks;
    }

    return {
      packageId,
      employees: employeeIds.length,
      assignedEmployees,
      createdRequirements,
      createdTasks,
    };
  }

  // ─── Tenant-wide report (missing / expiring) ────────────────────────────────

  async getRequirementsReport(
    tenantId: string,
    query: { status?: string; expiringInDays?: string },
  ) {
    const where: any = { tenantId };
    if (query.status) where.status = query.status;

    const data = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where,
      include: {
        documentType: true,
        package: true,
        uploadedDocument: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            position: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    let rows = data;
    if (query.expiringInDays) {
      const days = parseInt(query.expiringInDays, 10);
      rows = data.filter((r: any) => {
        if (!r.uploadedDocument?.expiresAt) return false;
        const diff = Math.ceil((new Date(r.uploadedDocument.expiresAt).getTime() - Date.now()) / 86400000);
        return diff >= 0 && diff <= days;
      });
    }

    return { data: rows, total: rows.length };
  }

  async syncRequirementForUploadedDocument(documentId: string, tenantId: string) {
    const document = await (this.prisma as any).hrEmployeeDocument.findFirst({
      where: { id: documentId, tenantId, deletedAt: null },
    });
    if (!document) return null;

    const documentType = await (this.prisma as any).hrDocumentType.findFirst({
      where: { tenantId, code: document.type },
      select: { id: true },
    });
    if (!documentType) return null;

    const requirement = await (this.prisma as any).hrEmployeeDocumentRequirement.findFirst({
      where: {
        tenantId,
        employeeId: document.employeeId,
        documentTypeId: documentType.id,
        status: { in: ['missing', 'expired'] },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (!requirement) return null;

    return (this.prisma as any).hrEmployeeDocumentRequirement.update({
      where: { id: requirement.id },
      data: {
        status: 'uploaded',
        uploadedDocumentId: document.id,
        verifiedAt: null,
        verifiedBy: null,
        waivedReason: null,
      },
    });
  }

  async revertRequirementForRemovedDocument(documentId: string, tenantId: string) {
    const requirements = await (this.prisma as any).hrEmployeeDocumentRequirement.findMany({
      where: { tenantId, uploadedDocumentId: documentId },
      select: { id: true },
    });
    if (!requirements.length) return 0;
    await (this.prisma as any).hrEmployeeDocumentRequirement.updateMany({
      where: { id: { in: requirements.map((item: any) => item.id) } },
      data: {
        status: 'missing',
        uploadedDocumentId: null,
        verifiedAt: null,
        verifiedBy: null,
      },
    });
    return requirements.length;
  }
}
