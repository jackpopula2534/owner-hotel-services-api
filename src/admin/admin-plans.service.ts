import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '../plans/entities/plan.entity';
import { PlanFeature } from '../plan-features/entities/plan-feature.entity';
import { Feature } from '../features/entities/feature.entity';
import { AddonService, isAddonAvailableForSystem } from '../modules/addons/addon.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminPlansListDto,
  AdminPlanItemDto,
  CreatePlanDto,
  UpdatePlanDto,
  PlanResponseDto,
  PlanFeatureItemDto,
  AssignFeatureToPlanDto,
  PlanFeaturesResponseDto,
  FeatureItemDto,
} from './dto/admin-plans.dto';

@Injectable()
export class AdminPlansService {
  private readonly logger = new Logger(AdminPlansService.name);

  constructor(
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
    @InjectRepository(PlanFeature)
    private planFeaturesRepository: Repository<PlanFeature>,
    @InjectRepository(Feature)
    private featuresRepository: Repository<Feature>,
    private readonly addonService: AddonService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Build a Map<planId, count> of how many add-ons each given plan has
   * assigned via `plan_addons`. Used to surface "Add-ons: N รายการ" badges
   * on the admin plan cards.
   *
   * Returns counts only — fetching full add-on rows here would be wasteful
   * because the card just shows a number. The detail list lives behind the
   * "จัดการ Add-ons" modal.
   */
  private async countAddonsByPlanIds(planIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (planIds.length === 0) return counts;

    // The Prisma client may not yet expose `plan_addons` in its generated
    // types until the next `prisma generate` runs after the migration; use
    // the runtime-available cast to keep TypeScript happy.
    const planAddonsClient = (
      this.prisma as unknown as {
        plan_addons: {
          groupBy: (
            args: Record<string, unknown>,
          ) => Promise<Array<{ plan_id: string; _count: { _all: number } }>>;
        };
      }
    ).plan_addons;

    const grouped = await planAddonsClient.groupBy({
      by: ['plan_id'],
      where: { plan_id: { in: planIds } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      counts.set(row.plan_id, row._count._all);
    }
    return counts;
  }

  /**
   * GET /api/v1/admin/plans
   * Get all plans with statistics
   */
  async findAll(): Promise<AdminPlansListDto> {
    const plans = await this.plansRepository
      .createQueryBuilder('plan')
      .leftJoinAndSelect('plan.subscriptions', 'subscription')
      .leftJoinAndSelect('plan.planFeatures', 'planFeature')
      .orderBy('plan.priceMonthly', 'ASC')
      .addOrderBy('plan.name', 'ASC')
      .getMany();

    const addonCounts = await this.countAddonsByPlanIds(plans.map((p) => p.id));

    const data: AdminPlanItemDto[] = plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      system: plan.system ?? 'HOTEL',
      name: plan.name,
      priceMonthly: Number(plan.priceMonthly || 0),
      priceYearly: plan.priceYearly ? Number(plan.priceYearly) : undefined,
      yearlyDiscountPercent: plan.yearlyDiscountPercent,
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      isActive: plan.isActive !== false,
      subscriptionCount: plan.subscriptions?.length || 0,
      featureCount: plan.planFeatures?.length || 0,
      addonCount: addonCounts.get(plan.id) ?? 0,
      // Sales Page fields
      description: plan.description,
      displayOrder: plan.displayOrder,
      isPopular: plan.isPopular,
      badge: plan.badge,
      highlightColor: plan.highlightColor,
      features: plan.features,
      buttonText: plan.buttonText,
    }));

    return {
      data,
      total: data.length,
    };
  }

  /**
   * GET /api/v1/admin/plans/:id
   * Get plan by ID with detailed information
   */
  async findOne(id: string): Promise<PlanResponseDto> {
    const plan = await this.plansRepository.findOne({
      where: { id },
      relations: ['planFeatures', 'planFeatures.feature', 'subscriptions'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${id}" not found`);
    }

    const planFeatures: PlanFeatureItemDto[] =
      plan.planFeatures?.map((pf) => ({
        id: pf.id,
        featureCode: pf.feature?.code || '',
        featureName: pf.feature?.name || '',
        priceMonthly: Number(pf.feature?.priceMonthly || 0),
      })) || [];

    const addonCountMap = await this.countAddonsByPlanIds([plan.id]);

    return {
      id: plan.id,
      code: plan.code,
      system: plan.system ?? 'HOTEL',
      name: plan.name,
      priceMonthly: Number(plan.priceMonthly || 0),
      priceYearly: plan.priceYearly ? Number(plan.priceYearly) : undefined,
      yearlyDiscountPercent: plan.yearlyDiscountPercent,
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      isActive: plan.isActive !== false,
      planFeatures,
      subscriptionCount: plan.subscriptions?.length || 0,
      addonCount: addonCountMap.get(plan.id) ?? 0,
      // Sales Page fields
      description: plan.description,
      displayOrder: plan.displayOrder,
      isPopular: plan.isPopular,
      badge: plan.badge,
      highlightColor: plan.highlightColor,
      features: plan.features,
      buttonText: plan.buttonText,
    };
  }

  /**
   * POST /api/v1/admin/plans
   * Create a new plan
   */
  async create(dto: CreatePlanDto): Promise<PlanResponseDto> {
    // Check if plan code already exists
    const existingPlan = await this.plansRepository.findOne({
      where: { code: dto.code },
    });

    if (existingPlan) {
      throw new ConflictException(`Plan with code "${dto.code}" already exists`);
    }

    // Validate business rules
    if (dto.maxRooms <= 0) {
      throw new BadRequestException('maxRooms must be greater than 0');
    }

    if (dto.maxUsers <= 0) {
      throw new BadRequestException('maxUsers must be greater than 0');
    }

    if (dto.priceMonthly < 0) {
      throw new BadRequestException('priceMonthly cannot be negative');
    }

    // Auto-calculate yearly price if not provided
    let yearlyPrice = dto.priceYearly;
    if (!yearlyPrice && dto.yearlyDiscountPercent) {
      const monthlyTotal = dto.priceMonthly * 12;
      yearlyPrice = monthlyTotal * (1 - dto.yearlyDiscountPercent / 100);
    }

    const plan = this.plansRepository.create({
      code: dto.code,
      // แผนใหม่เป็นของสายธุรกิจโรงแรมโดย default — ระบุ CAMP เพื่อสร้างแผนลานกางเต็นท์
      system: dto.system ?? 'HOTEL',
      name: dto.name,
      priceMonthly: dto.priceMonthly,
      priceYearly: yearlyPrice,
      yearlyDiscountPercent: dto.yearlyDiscountPercent ?? 0,
      maxRooms: dto.maxRooms,
      maxUsers: dto.maxUsers,
      isActive: dto.isActive !== false,
      // Sales Page fields
      description: dto.description,
      displayOrder: dto.displayOrder ?? 0,
      isPopular: dto.isPopular ?? false,
      badge: dto.badge,
      highlightColor: dto.highlightColor,
      features: dto.features,
      buttonText: dto.buttonText ?? 'เริ่มใช้งาน',
    });

    await this.plansRepository.save(plan);

    this.logger.log(`Created plan: ${plan.name} (${plan.code})`);

    return this.findOne(plan.id);
  }

  /**
   * PATCH /api/v1/admin/plans/:id
   * Update a plan
   */
  async update(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    const plan = await this.plansRepository.findOne({
      where: { id },
      relations: ['subscriptions'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${id}" not found`);
    }

    // Validate business rules
    if (dto.maxRooms !== undefined && dto.maxRooms <= 0) {
      throw new BadRequestException('maxRooms must be greater than 0');
    }

    if (dto.maxUsers !== undefined && dto.maxUsers <= 0) {
      throw new BadRequestException('maxUsers must be greater than 0');
    }

    if (dto.priceMonthly !== undefined && dto.priceMonthly < 0) {
      throw new BadRequestException('priceMonthly cannot be negative');
    }

    // Check if plan has active subscriptions before reducing limits
    const hasActiveSubscriptions = plan.subscriptions?.length > 0;
    if (hasActiveSubscriptions) {
      if (dto.maxRooms !== undefined && dto.maxRooms < plan.maxRooms) {
        this.logger.warn(`Reducing maxRooms for plan "${plan.code}" with active subscriptions`);
      }
      if (dto.maxUsers !== undefined && dto.maxUsers < plan.maxUsers) {
        this.logger.warn(`Reducing maxUsers for plan "${plan.code}" with active subscriptions`);
      }
    }

    // Update fields
    if (dto.name !== undefined) plan.name = dto.name;
    // Switching a plan's business line invalidates any add-on bundled from the
    // old line — see the prune after save().
    const systemChanged = dto.system !== undefined && dto.system !== plan.system;
    if (dto.system !== undefined) plan.system = dto.system;
    if (dto.priceMonthly !== undefined) plan.priceMonthly = dto.priceMonthly;
    if (dto.maxRooms !== undefined) plan.maxRooms = dto.maxRooms;
    if (dto.maxUsers !== undefined) plan.maxUsers = dto.maxUsers;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;

    // Update pricing fields
    if (dto.priceYearly !== undefined) {
      plan.priceYearly = dto.priceYearly;
    } else if (dto.yearlyDiscountPercent !== undefined) {
      // Auto-calculate if discount changed but price not provided
      const monthlyTotal = plan.priceMonthly * 12;
      plan.priceYearly = monthlyTotal * (1 - dto.yearlyDiscountPercent / 100);
    }
    if (dto.yearlyDiscountPercent !== undefined)
      plan.yearlyDiscountPercent = dto.yearlyDiscountPercent;

    // Update Sales Page fields
    if (dto.description !== undefined) plan.description = dto.description;
    if (dto.displayOrder !== undefined) plan.displayOrder = dto.displayOrder;
    if (dto.isPopular !== undefined) plan.isPopular = dto.isPopular;
    if (dto.badge !== undefined) plan.badge = dto.badge;
    if (dto.highlightColor !== undefined) plan.highlightColor = dto.highlightColor;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.buttonText !== undefined) plan.buttonText = dto.buttonText;

    await this.plansRepository.save(plan);

    if (systemChanged) {
      await this.unbundleCrossSystemAddons(plan.id, plan.code, plan.system);
    }

    this.logger.log(`Updated plan: ${plan.name} (${plan.code})`);

    return this.findOne(plan.id);
  }

  /**
   * A plan that moves to the other business line keeps its old `plan_addons`
   * rows, which would silently entitle every tenant on it to modules from the
   * line it just left (a hotel plan flipped to CAMP would still hand out
   * Housekeeping). Drop those rows and clear the tenants' entitlement cache.
   */
  private async unbundleCrossSystemAddons(
    planId: string,
    planCode: string,
    planSystem: string,
  ): Promise<void> {
    const planAddonsClient = (this.prisma as unknown as { plan_addons: any }).plan_addons;
    const rows: Array<{ addon_id: string; add_ons?: { code: string; system: string } | null }> =
      await planAddonsClient.findMany({
        where: { plan_id: planId },
        include: { add_ons: { select: { code: true, system: true } } },
      });

    const stale = rows.filter(
      (row) => row.add_ons && !isAddonAvailableForSystem(row.add_ons.system, planSystem),
    );
    if (stale.length === 0) return;

    await planAddonsClient.deleteMany({
      where: { plan_id: planId, addon_id: { in: stale.map((row) => row.addon_id) } },
    });
    await this.addonService.invalidateAddonCacheForPlan(planId);

    this.logger.log(
      `Plan ${planCode} moved to ${planSystem} — unbundled ` +
        `${stale.map((row) => row.add_ons?.code).join(', ')} (cross product line)`,
    );
  }

  /**
   * DELETE /api/v1/admin/plans/:id
   * Delete a plan (soft delete by setting isActive to false)
   */
  async remove(id: string): Promise<{ message: string }> {
    const plan = await this.plansRepository.findOne({
      where: { id },
      relations: ['subscriptions'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${id}" not found`);
    }

    // Check if plan has active subscriptions
    const hasActiveSubscriptions = plan.subscriptions?.length > 0;
    if (hasActiveSubscriptions) {
      throw new BadRequestException(
        `Cannot delete plan "${plan.name}" because it has ${plan.subscriptions.length} active subscription(s). Please deactivate it instead.`,
      );
    }

    // Soft delete by setting isActive to false
    plan.isActive = false;
    await this.plansRepository.save(plan);

    this.logger.log(`Deleted plan: ${plan.name} (${plan.code})`);

    return {
      message: `Plan "${plan.name}" deleted successfully`,
    };
  }

  /**
   * POST /api/v1/admin/plans/:planId/features
   * Assign a feature to a plan
   */
  async assignFeatureToPlan(planId: string, dto: AssignFeatureToPlanDto): Promise<PlanResponseDto> {
    // Verify plan exists
    const plan = await this.plansRepository.findOne({
      where: { id: planId },
      relations: ['planFeatures', 'planFeatures.feature', 'subscriptions'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }

    // Verify feature exists
    const feature = await this.featuresRepository.findOne({
      where: { id: dto.featureId },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${dto.featureId}" not found`);
    }

    // Check if feature is already assigned to this plan
    const existingPlanFeature = await this.planFeaturesRepository.findOne({
      where: {
        planId,
        featureId: dto.featureId,
      },
    });

    if (existingPlanFeature) {
      throw new ConflictException(
        `Feature "${feature.name}" is already assigned to plan "${plan.name}"`,
      );
    }

    // Create plan_features record
    const planFeature = this.planFeaturesRepository.create({
      planId,
      featureId: dto.featureId,
    });

    await this.planFeaturesRepository.save(planFeature);

    this.logger.log(`Assigned feature "${feature.name}" to plan "${plan.name}" (${plan.code})`);

    // Bust the entitlement cache for every tenant currently on this plan so
    // their sidebar reflects the new feature without waiting for the 5min TTL.
    await this.addonService.invalidateAddonCacheForPlan(planId);

    return this.findOne(planId);
  }

  /**
   * DELETE /api/v1/admin/plans/:planId/features/:featureId
   * Remove a feature from a plan
   */
  async removeFeatureFromPlan(planId: string, featureId: string): Promise<{ message: string }> {
    // Verify plan exists
    const plan = await this.plansRepository.findOne({
      where: { id: planId },
      relations: ['planFeatures', 'planFeatures.feature'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }

    // Verify feature exists
    const feature = await this.featuresRepository.findOne({
      where: { id: featureId },
    });

    if (!feature) {
      throw new NotFoundException(`Feature with ID "${featureId}" not found`);
    }

    // Find and delete the plan_features record
    const planFeature = await this.planFeaturesRepository.findOne({
      where: {
        planId,
        featureId,
      },
    });

    if (!planFeature) {
      throw new NotFoundException(
        `Feature "${feature.name}" is not assigned to plan "${plan.name}"`,
      );
    }

    await this.planFeaturesRepository.remove(planFeature);

    this.logger.log(`Removed feature "${feature.name}" from plan "${plan.name}" (${plan.code})`);

    // Bust the entitlement cache for every tenant currently on this plan so
    // their sidebar reflects the removed feature without waiting for the TTL.
    await this.addonService.invalidateAddonCacheForPlan(planId);

    return {
      message: `Feature "${feature.name}" removed from plan "${plan.name}" successfully`,
    };
  }

  /**
   * GET /api/v1/admin/plans/:planId/features
   * Get all features for a plan (assigned + available)
   */
  async getPlanFeatures(planId: string): Promise<PlanFeaturesResponseDto> {
    // Verify plan exists
    const plan = await this.plansRepository.findOne({
      where: { id: planId },
      relations: ['planFeatures', 'planFeatures.feature'],
    });

    if (!plan) {
      throw new NotFoundException(`Plan with ID "${planId}" not found`);
    }

    // Get all active features
    const allFeatures = await this.featuresRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    // Map assigned features
    const assignedFeatures: PlanFeatureItemDto[] =
      plan.planFeatures?.map((pf) => ({
        id: pf.id,
        featureCode: pf.feature?.code || '',
        featureName: pf.feature?.name || '',
        priceMonthly: Number(pf.feature?.priceMonthly || 0),
      })) || [];

    // Get IDs of assigned features
    const assignedFeatureIds = new Set(plan.planFeatures?.map((pf) => pf.featureId) || []);

    // Map available features (not yet assigned)
    const availableFeatures: FeatureItemDto[] = allFeatures
      .filter((f) => !assignedFeatureIds.has(f.id))
      .map((f) => ({
        id: f.id,
        code: f.code,
        name: f.name,
        description: f.description || undefined,
        type: f.type,
        priceMonthly: Number(f.priceMonthly || 0),
        isActive: f.isActive,
      }));

    return {
      assignedFeatures,
      availableFeatures,
    };
  }
}
