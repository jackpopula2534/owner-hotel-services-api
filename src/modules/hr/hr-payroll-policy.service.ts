import {
  Injectable,
  NotFoundException,
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
  CreateHrPayrollPolicyDto,
  UpdateHrPayrollPolicyDto,
} from './dto/create-hr-payroll-policy.dto';

/**
 * Payroll policy configuration (P1-06): cutoff, pay period, OT rules,
 * paid/unpaid leave handling, social security. Consumed by HrPayrollService.
 */
@Injectable()
export class HrPayrollPolicyService {
  private readonly logger = new Logger(HrPayrollPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Default policy values when a tenant has not configured one yet. */
  static readonly DEFAULTS = {
    payPeriod: 'monthly',
    cutoffDay: 25,
    payDay: 30,
    workingDaysPerMonth: 30,
    workingHoursPerDay: 8,
    otMultiplier: 1.5,
    holidayOtMultiplier: 2.0,
    otRequiresApproval: true,
    paidLeaveDeducted: false,
    unpaidLeaveRate: 1.0,
    socialSecurityEnabled: true,
    socialSecurityRate: 0.05,
    socialSecurityCap: 750,
    taxEnabled: false,
    lateDeductionPerMin: 0,
  };

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.propertyId) where['propertyId'] = query.propertyId;
    if (query.isActive !== undefined) where['isActive'] = query.isActive === 'true';
    const data = await (this.prisma as any).hrPayrollPolicy.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const policy = await (this.prisma as any).hrPayrollPolicy.findFirst({
      where: { id, tenantId },
    });
    if (!policy) throw new NotFoundException(`Payroll policy ${id} not found`);
    return policy;
  }

  /**
   * Resolve the effective policy for a tenant/property. Falls back to the
   * tenant default, then to static DEFAULTS, so payroll always has a config.
   */
  async resolveEffective(tenantId: string, propertyId?: string | null) {
    const policies = await (this.prisma as any).hrPayrollPolicy.findMany({
      where: { tenantId, isActive: true },
      orderBy: { isDefault: 'desc' },
    });
    const byProperty = propertyId
      ? policies.find((p: any) => p.propertyId === propertyId)
      : undefined;
    const def = policies.find((p: any) => p.isDefault) ?? policies[0];
    const resolved = byProperty ?? def;
    if (resolved) return this.normalize(resolved);
    return { ...HrPayrollPolicyService.DEFAULTS, id: null, name: 'system-default' };
  }

  /** Coerce Decimal/string fields to plain numbers for the engine. */
  private normalize(policy: any) {
    return {
      ...policy,
      otMultiplier: Number(policy.otMultiplier),
      holidayOtMultiplier: Number(policy.holidayOtMultiplier),
      unpaidLeaveRate: Number(policy.unpaidLeaveRate),
      socialSecurityRate: Number(policy.socialSecurityRate),
      socialSecurityCap: Number(policy.socialSecurityCap),
      lateDeductionPerMin: Number(policy.lateDeductionPerMin),
    };
  }

  async create(dto: CreateHrPayrollPolicyDto, tenantId: string, userId?: string) {
    if (dto.isDefault) await this.clearDefault(tenantId);
    const policy = await (this.prisma as any).hrPayrollPolicy.create({
      data: this.buildData(dto, tenantId),
    });
    await this.audit(AuditAction.PAYROLL_POLICY_UPDATE, policy.id, tenantId, userId, {
      action: 'create',
      name: dto.name,
    });
    return policy;
  }

  async update(id: string, dto: UpdateHrPayrollPolicyDto, tenantId: string, userId?: string) {
    await this.findOne(id, tenantId);
    if (dto.isDefault) await this.clearDefault(tenantId, id);
    const policy = await (this.prisma as any).hrPayrollPolicy.update({
      where: { id },
      data: this.buildData(dto, tenantId, true),
    });
    await this.audit(AuditAction.PAYROLL_POLICY_UPDATE, id, tenantId, userId, {
      action: 'update',
    });
    return policy;
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrPayrollPolicy.delete({ where: { id } });
  }

  private async clearDefault(tenantId: string, exceptId?: string) {
    await (this.prisma as any).hrPayrollPolicy.updateMany({
      where: { tenantId, isDefault: true, ...(exceptId && { id: { not: exceptId } }) },
      data: { isDefault: false },
    });
  }

  private buildData(
    dto: CreateHrPayrollPolicyDto | UpdateHrPayrollPolicyDto,
    tenantId: string,
    partial = false,
  ) {
    const decimal = (v: number | undefined, d: number) =>
      v !== undefined ? v.toFixed(4) : partial ? undefined : d.toFixed(4);
    const money = (v: number | undefined, d: number) =>
      v !== undefined ? v.toFixed(2) : partial ? undefined : d.toFixed(2);
    const D = HrPayrollPolicyService.DEFAULTS;
    const base: Record<string, unknown> = {
      ...(partial ? {} : { tenantId }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.propertyId !== undefined && { propertyId: dto.propertyId ?? null }),
      ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      ...(dto.payPeriod !== undefined && { payPeriod: dto.payPeriod }),
      ...(dto.cutoffDay !== undefined && { cutoffDay: dto.cutoffDay }),
      ...(dto.payDay !== undefined && { payDay: dto.payDay }),
      ...(dto.workingDaysPerMonth !== undefined && {
        workingDaysPerMonth: dto.workingDaysPerMonth,
      }),
      ...(dto.workingHoursPerDay !== undefined && { workingHoursPerDay: dto.workingHoursPerDay }),
      ...(dto.otRequiresApproval !== undefined && { otRequiresApproval: dto.otRequiresApproval }),
      ...(dto.paidLeaveDeducted !== undefined && { paidLeaveDeducted: dto.paidLeaveDeducted }),
      ...(dto.socialSecurityEnabled !== undefined && {
        socialSecurityEnabled: dto.socialSecurityEnabled,
      }),
      ...(dto.taxEnabled !== undefined && { taxEnabled: dto.taxEnabled }),
      ...(dto.note !== undefined && { note: dto.note ?? null }),
    };
    const otMultiplier = money(dto.otMultiplier, D.otMultiplier);
    const holidayOtMultiplier = money(dto.holidayOtMultiplier, D.holidayOtMultiplier);
    const unpaidLeaveRate = money(dto.unpaidLeaveRate, D.unpaidLeaveRate);
    const socialSecurityRate = decimal(dto.socialSecurityRate, D.socialSecurityRate);
    const socialSecurityCap = money(dto.socialSecurityCap, D.socialSecurityCap);
    const lateDeductionPerMin = money(dto.lateDeductionPerMin, D.lateDeductionPerMin);
    if (otMultiplier !== undefined) base['otMultiplier'] = otMultiplier;
    if (holidayOtMultiplier !== undefined) base['holidayOtMultiplier'] = holidayOtMultiplier;
    if (unpaidLeaveRate !== undefined) base['unpaidLeaveRate'] = unpaidLeaveRate;
    if (socialSecurityRate !== undefined) base['socialSecurityRate'] = socialSecurityRate;
    if (socialSecurityCap !== undefined) base['socialSecurityCap'] = socialSecurityCap;
    if (lateDeductionPerMin !== undefined) base['lateDeductionPerMin'] = lateDeductionPerMin;
    return base;
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
        resource: AuditResource.PAYROLL_POLICY,
        resourceId,
        category: AuditCategory.HR,
        tenantId,
        userId,
        newValues,
        description: 'Payroll policy changed',
      })
      .catch((err) => this.logger.error(`Audit log failed: ${err.message}`));
  }
}
