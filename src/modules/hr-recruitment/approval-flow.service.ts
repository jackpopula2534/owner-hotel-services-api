import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApproverRole } from '../../common/types/approval-chain';

export type FlowType = 'manpower' | 'budget' | 'equipment';

export const FLOW_TYPES: FlowType[] = ['manpower', 'budget', 'equipment'];
const VALID_ROLES: ApproverRole[] = ['dept_head', 'hr', 'owner'];

/** Built-in defaults used when a tenant has no saved config yet. */
export const DEFAULT_FLOW_ROLES: Record<FlowType, ApproverRole[]> = {
  manpower: ['dept_head', 'hr', 'owner'],
  budget: ['hr', 'owner'],
  equipment: ['hr', 'owner'],
};

export interface FlowStep {
  role: ApproverRole;
  label?: string | null;
}

/**
 * Setup Flow — configurable approval chains per tenant (manpower / budget /
 * equipment). Falls back to built-in defaults and lazily persists them on first
 * read so every tenant always has an editable config row.
 */
@Injectable()
export class ApprovalFlowService {
  private readonly logger = new Logger(ApprovalFlowService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  private assertFlowType(flowType: string): asserts flowType is FlowType {
    if (!FLOW_TYPES.includes(flowType as FlowType)) {
      throw new BadRequestException(`Unknown flow type "${flowType}"`);
    }
  }

  private normalizeSteps(steps: unknown): FlowStep[] {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new BadRequestException('At least one approval step is required');
    }
    return steps.map((s: any, i) => {
      const role = s?.role;
      if (!VALID_ROLES.includes(role)) {
        throw new BadRequestException(`Step ${i + 1}: invalid role "${role}"`);
      }
      return { role, label: s?.label ?? null };
    });
  }

  /** Get all 3 flows for a tenant, creating defaults for any that are missing. */
  async getAll(tenantId: string): Promise<Array<{ flowType: FlowType; steps: FlowStep[]; isActive: boolean }>> {
    const rows = await this.db.hrApprovalFlow.findMany({ where: { tenantId } });
    const byType = new Map<string, any>(rows.map((r: any) => [r.flowType, r]));
    const result: Array<{ flowType: FlowType; steps: FlowStep[]; isActive: boolean }> = [];

    for (const flowType of FLOW_TYPES) {
      const existing = byType.get(flowType);
      if (existing) {
        result.push({ flowType, steps: existing.steps as FlowStep[], isActive: existing.isActive });
      } else {
        const steps = DEFAULT_FLOW_ROLES[flowType].map((role) => ({ role, label: null }));
        await this.db.hrApprovalFlow.create({ data: { tenantId, flowType, steps, isActive: true } });
        result.push({ flowType, steps, isActive: true });
      }
    }
    return result;
  }

  /** Update (upsert) one flow's ordered steps. */
  async update(
    tenantId: string,
    flowType: string,
    steps: unknown,
  ): Promise<{ flowType: FlowType; steps: FlowStep[]; isActive: boolean }> {
    this.assertFlowType(flowType);
    const normalized = this.normalizeSteps(steps);
    const row = await this.db.hrApprovalFlow.upsert({
      where: { tenantId_flowType: { tenantId, flowType } },
      create: { tenantId, flowType, steps: normalized, isActive: true },
      update: { steps: normalized },
    });
    return { flowType: flowType as FlowType, steps: row.steps as FlowStep[], isActive: row.isActive };
  }

  /**
   * Setup — หมวดสินค้าคลัง (inventory ItemCategory ids) ที่ HR กำหนดให้ดึง item
   * มาเลือกในโมดัล "เปิด/ขออุปกรณ์" ของ recruitment. เก็บไว้บน row flowType=equipment
   * ([] / null = ไม่กรอง = ดึงทุกหมวด).
   */
  async getEquipmentCategories(tenantId: string): Promise<string[]> {
    const row = await this.db.hrApprovalFlow.findUnique({
      where: { tenantId_flowType: { tenantId, flowType: 'equipment' } },
    });
    return this.normalizeCategoryIds(row?.equipmentCategoryIds);
  }

  /** Save the configured inventory category ids (upserts the equipment flow row). */
  async setEquipmentCategories(tenantId: string, categoryIds: unknown): Promise<string[]> {
    const ids = this.normalizeCategoryIds(categoryIds);
    const defaults = DEFAULT_FLOW_ROLES.equipment.map((role) => ({ role, label: null }));
    const row = await this.db.hrApprovalFlow.upsert({
      where: { tenantId_flowType: { tenantId, flowType: 'equipment' } },
      create: { tenantId, flowType: 'equipment', steps: defaults, isActive: true, equipmentCategoryIds: ids },
      update: { equipmentCategoryIds: ids },
    });
    return this.normalizeCategoryIds(row.equipmentCategoryIds);
  }

  private normalizeCategoryIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      ),
    );
  }

  /**
   * Resolve the ordered approver roles for a flow type — config first, with
   * built-in defaults as fallback. Used by services that build chains.
   */
  async resolveRoles(tenantId: string, flowType: FlowType): Promise<ApproverRole[]> {
    try {
      const row = await this.db.hrApprovalFlow.findUnique({
        where: { tenantId_flowType: { tenantId, flowType } },
      });
      if (row?.isActive && Array.isArray(row.steps) && row.steps.length > 0) {
        return (row.steps as FlowStep[])
          .map((s) => s.role)
          .filter((r): r is ApproverRole => VALID_ROLES.includes(r));
      }
    } catch (e) {
      this.logger.warn(`resolveRoles fallback for ${flowType}: ${e instanceof Error ? e.message : e}`);
    }
    return DEFAULT_FLOW_ROLES[flowType];
  }
}
