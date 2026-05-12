import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddonService } from '../modules/addons/addon.service';
import {
  PlanAddonsResponseDto,
  PlanAddonItemDto,
  AvailableAddonItemDto,
  AssignAddonToPlanDto,
} from './dto/admin-plan-addons.dto';

/**
 * Service that manages the join between `plans` and `add_ons`.
 *
 * Storage lives in the Prisma-managed table `plan_addons`. The TypeORM
 * `Plan` entity is intentionally not extended; this service stays in the
 * Prisma layer (matching `AddonService`) so we don't need a parallel TypeORM
 * entity for the same join.
 */
@Injectable()
export class AdminPlanAddonsService {
  private readonly logger = new Logger(AdminPlanAddonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  // The Prisma client may be missing the freshly added `plan_addons` model on
  // the generated types until `prisma generate` runs. Cast through `unknown`
  // so we don't lose type safety elsewhere.
  private get planAddonsClient(): {
    findMany: (args?: Record<string, unknown>) => Promise<any[]>;
    findUnique: (args: Record<string, unknown>) => Promise<any | null>;
    create: (args: Record<string, unknown>) => Promise<any>;
    delete: (args: Record<string, unknown>) => Promise<any>;
    deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  } {
    return (this.prisma as unknown as { plan_addons: any }).plan_addons;
  }

  private get addOnsClient(): {
    findUnique: (args: Record<string, unknown>) => Promise<any | null>;
    findMany: (args?: Record<string, unknown>) => Promise<any[]>;
  } {
    return (this.prisma as unknown as { add_ons: any }).add_ons;
  }

  /**
   * GET /api/v1/admin/plans/:planId/addons
   * Returns add-ons currently assigned to the plan + active add-ons not yet
   * assigned (so the UI can show two lists side-by-side).
   */
  async getPlanAddons(planId: string): Promise<PlanAddonsResponseDto> {
    await this.assertPlanExists(planId);

    const [assignedRows, allActiveAddons] = await Promise.all([
      this.planAddonsClient.findMany({
        where: { plan_id: planId },
        include: { add_ons: true },
        orderBy: [{ created_at: 'asc' }],
      }),
      this.addOnsClient.findMany({
        where: { is_active: 1 },
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const assignedAddons: PlanAddonItemDto[] = assignedRows
      .filter((row) => !!row.add_ons)
      .map((row) => ({
        id: row.add_ons.id,
        planAddonId: row.id,
        addonCode: row.add_ons.code,
        addonName: row.add_ons.name,
        price: Number(row.add_ons.price ?? 0),
        billingCycle: row.add_ons.billing_cycle,
        category: row.add_ons.category ?? null,
      }));

    const assignedAddonIds = new Set(assignedAddons.map((a) => a.id));

    const availableAddons: AvailableAddonItemDto[] = allActiveAddons
      .filter((addon) => !assignedAddonIds.has(addon.id))
      .map((addon) => ({
        id: addon.id,
        code: addon.code,
        name: addon.name,
        description: addon.description ?? null,
        price: Number(addon.price ?? 0),
        billingCycle: addon.billing_cycle,
        category: addon.category ?? null,
        isActive: Number(addon.is_active) === 1,
      }));

    return { assignedAddons, availableAddons };
  }

  /**
   * POST /api/v1/admin/plans/:planId/addons
   * Assign an add-on to a plan. Refuses duplicates so that the unique index
   * (plan_id, addon_id) is never violated at the DB level.
   */
  async assignAddonToPlan(
    planId: string,
    dto: AssignAddonToPlanDto,
  ): Promise<PlanAddonsResponseDto> {
    await this.assertPlanExists(planId);

    const addon = await this.addOnsClient.findUnique({ where: { id: dto.addonId } });
    if (!addon) {
      throw new NotFoundException(`Add-on with ID "${dto.addonId}" not found`);
    }

    const existing = await this.planAddonsClient.findUnique({
      where: {
        plan_id_addon_id: { plan_id: planId, addon_id: dto.addonId },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Add-on "${addon.name}" is already assigned to this plan`,
      );
    }

    await this.planAddonsClient.create({
      data: { plan_id: planId, addon_id: dto.addonId },
    });

    this.logger.log(`Assigned add-on "${addon.name}" (${addon.code}) to plan ${planId}`);

    // Tenants on this plan may have their entitlement cache, mirror the
    // behaviour of the Plan-Features endpoints.
    await this.addonService.invalidateAddonCacheForPlan(planId);

    return this.getPlanAddons(planId);
  }

  /**
   * DELETE /api/v1/admin/plans/:planId/addons/:addonId
   * Remove an add-on from a plan.
   */
  async removeAddonFromPlan(
    planId: string,
    addonId: string,
  ): Promise<{ message: string }> {
    await this.assertPlanExists(planId);

    const addon = await this.addOnsClient.findUnique({ where: { id: addonId } });
    if (!addon) {
      throw new NotFoundException(`Add-on with ID "${addonId}" not found`);
    }

    const result = await this.planAddonsClient.deleteMany({
      where: { plan_id: planId, addon_id: addonId },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        `Add-on "${addon.name}" is not assigned to this plan`,
      );
    }

    this.logger.log(`Removed add-on "${addon.name}" (${addon.code}) from plan ${planId}`);

    await this.addonService.invalidateAddonCacheForPlan(planId);

    return {
      message: `Add-on "${addon.name}" removed from plan successfully`,
    };
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  private async assertPlanExists(planId: string): Promise<void> {
    const plansClient = (this.prisma as unknown as {
      plans: { findUnique: (args: Record<string, unknown>) => Promise<any | null> };
    }).plans;

    const plan = await plansClient.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }
  }
}
