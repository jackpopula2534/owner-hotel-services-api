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
import {
  AdminPlansListDto,
  AdminPlanItemDto,
  CreatePlanDto,
  UpdatePlanDto,
  PlanResponseDto,
  PlanFeatureItemDto,
} from './dto/admin-plans.dto';

@Injectable()
export class AdminPlansService {
  private readonly logger = new Logger(AdminPlansService.name);

  constructor(
    @InjectRepository(Plan)
    private plansRepository: Repository<Plan>,
  ) {}

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

    const data: AdminPlanItemDto[] = plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      priceMonthly: Number(plan.priceMonthly || 0),
      priceYearly: plan.priceYearly ? Number(plan.priceYearly) : undefined,
      yearlyDiscountPercent: plan.yearlyDiscountPercent,
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      isActive: plan.isActive !== false,
      subscriptionCount: plan.subscriptions?.length || 0,
      featureCount: plan.planFeatures?.length || 0,
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

    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      priceMonthly: Number(plan.priceMonthly || 0),
      priceYearly: plan.priceYearly ? Number(plan.priceYearly) : undefined,
      yearlyDiscountPercent: plan.yearlyDiscountPercent,
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      isActive: plan.isActive !== false,
      planFeatures,
      subscriptionCount: plan.subscriptions?.length || 0,
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
      throw new ConflictException(
        `Plan with code "${dto.code}" already exists`,
      );
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
        this.logger.warn(
          `Reducing maxRooms for plan "${plan.code}" with active subscriptions`,
        );
      }
      if (dto.maxUsers !== undefined && dto.maxUsers < plan.maxUsers) {
        this.logger.warn(
          `Reducing maxUsers for plan "${plan.code}" with active subscriptions`,
        );
      }
    }

    // Update fields
    if (dto.name !== undefined) plan.name = dto.name;
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
    if (dto.highlightColor !== undefined)
      plan.highlightColor = dto.highlightColor;
    if (dto.features !== undefined) plan.features = dto.features;
    if (dto.buttonText !== undefined) plan.buttonText = dto.buttonText;

    await this.plansRepository.save(plan);

    this.logger.log(`Updated plan: ${plan.name} (${plan.code})`);

    return this.findOne(plan.id);
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
}
