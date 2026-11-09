import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHrLeavePolicyDto, UpdateHrLeavePolicyDto } from './dto/hr-leave-policy.dto';

export interface EffectiveLeavePolicy {
  id: string | null;
  approvalLevels: number;
  requiresAttachment: boolean;
  entitlementDays: number;
  blackoutDates: string[];
}

/**
 * Leave policy by tenure / leave type (P2-05). Drives approval depth,
 * attachment requirement and blackout dates for leave requests.
 */
@Injectable()
export class HrLeavePolicyService {
  private readonly logger = new Logger(HrLeavePolicyService.name);

  static readonly DEFAULT: EffectiveLeavePolicy = {
    id: null,
    approvalLevels: 1,
    requiresAttachment: false,
    entitlementDays: 0,
    blackoutDates: [],
  };

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: Record<string, string>, tenantId: string) {
    const where: Record<string, unknown> = { tenantId };
    if (query.leaveTypeId) where['leaveTypeId'] = query.leaveTypeId;
    const data = await (this.prisma as any).hrLeavePolicy.findMany({
      where,
      orderBy: [{ leaveTypeId: 'asc' }, { minTenureMonths: 'desc' }],
    });
    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const policy = await (this.prisma as any).hrLeavePolicy.findFirst({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException(`Leave policy ${id} not found`);
    return policy;
  }

  /** Resolve the policy that applies to a leave type given tenure in months. */
  async resolveEffective(
    tenantId: string,
    leaveTypeId: string,
    tenureMonths: number,
  ): Promise<EffectiveLeavePolicy> {
    const policies = await (this.prisma as any).hrLeavePolicy.findMany({
      where: { tenantId, isActive: true, OR: [{ leaveTypeId }, { leaveTypeId: null }] },
      orderBy: { minTenureMonths: 'desc' },
    });
    const eligible = policies
      .filter((p: any) => p.minTenureMonths <= tenureMonths)
      .sort((a: any, b: any) => {
        // prefer leaveType-specific over generic, then higher tenure
        const spec = Number(!!b.leaveTypeId) - Number(!!a.leaveTypeId);
        return spec !== 0 ? spec : b.minTenureMonths - a.minTenureMonths;
      });
    const chosen = eligible[0];
    if (!chosen) return HrLeavePolicyService.DEFAULT;
    return {
      id: chosen.id,
      approvalLevels: chosen.approvalLevels,
      requiresAttachment: chosen.requiresAttachment,
      entitlementDays: chosen.entitlementDays,
      blackoutDates: Array.isArray(chosen.blackoutDates) ? chosen.blackoutDates : [],
    };
  }

  async create(dto: CreateHrLeavePolicyDto, tenantId: string) {
    return (this.prisma as any).hrLeavePolicy.create({
      data: {
        tenantId,
        leaveTypeId: dto.leaveTypeId ?? null,
        name: dto.name,
        minTenureMonths: dto.minTenureMonths ?? 0,
        entitlementDays: dto.entitlementDays ?? 0,
        requiresAttachment: dto.requiresAttachment ?? false,
        approvalLevels: dto.approvalLevels ?? 1,
        blackoutDates: dto.blackoutDates ?? undefined,
        isActive: dto.isActive ?? true,
        note: dto.note ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateHrLeavePolicyDto, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrLeavePolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.leaveTypeId !== undefined && { leaveTypeId: dto.leaveTypeId ?? null }),
        ...(dto.minTenureMonths !== undefined && { minTenureMonths: dto.minTenureMonths }),
        ...(dto.entitlementDays !== undefined && { entitlementDays: dto.entitlementDays }),
        ...(dto.requiresAttachment !== undefined && { requiresAttachment: dto.requiresAttachment }),
        ...(dto.approvalLevels !== undefined && { approvalLevels: dto.approvalLevels }),
        ...(dto.blackoutDates !== undefined && { blackoutDates: dto.blackoutDates }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
    });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    return (this.prisma as any).hrLeavePolicy.delete({ where: { id } });
  }
}
