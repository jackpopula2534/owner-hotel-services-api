import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import {
  PublicPlansListDto,
  PublicPlanDto,
  PublicPlanFeatureDto,
  PublicPlanAddonDto,
} from './dto/public-plans.dto';

@ApiTags('Public - Plans (Sales Page)')
@Controller({ path: 'plans', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  create(@Body() createPlanDto: CreatePlanDto) {
    return this.plansService.create(createPlanDto);
  }

  /**
   * GET /api/v1/plans
   * Public endpoint for Sales Page - No authentication required
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Get all active plans for Sales Page',
    description:
      'Public endpoint that returns all active subscription plans with sales page information. ' +
      'Pass ?system=HOTEL|CAMP to return only that product line; omit it to return every plan. ' +
      'No authentication required.',
  })
  @ApiQuery({ name: 'system', required: false, enum: ['HOTEL', 'CAMP'] })
  @ApiResponse({
    status: 200,
    description: 'Plans retrieved successfully',
    type: PublicPlansListDto,
  })
  async findAll(@Query('system') system?: string): Promise<PublicPlansListDto> {
    const plans = await this.plansService.findAll();
    const normalized = this.normalizeSystemFilter(system);
    const data: PublicPlanDto[] = plans
      .map((plan) => this.toPublicPlanDto(plan))
      .filter((plan) => !normalized || plan.system === normalized);
    return {
      data,
      total: data.length,
    };
  }

  /**
   * Accept only the two real product lines; ignore blanks/garbage so a bad
   * query string degrades to "show all plans" rather than an empty list.
   * Plans are always HOTEL or CAMP (never BOTH), so no BOTH pass-through here.
   */
  private normalizeSystemFilter(system?: string): 'HOTEL' | 'CAMP' | null {
    const upper = system?.trim().toUpperCase();
    return upper === 'HOTEL' || upper === 'CAMP' ? upper : null;
  }

  /**
   * Map a plan record (with includes for plan_features.features and
   * plan_addons.add_ons) into the public DTO shape used by the sales page.
   *
   * Two sources of "extras" are exposed:
   *   - addOnFeatures   → from `features` table via plan_features (legacy)
   *   - includedAddOns  → from `add_ons` catalog via plan_addons (curated by
   *                       admin in /admin/plans/:id/addons). Granted to
   *                       subscribers without extra charge.
   */
  private toPublicPlanDto(plan: any): PublicPlanDto {
    // Parse marketing feature bullets stored as JSON-stringified array.
    let featuresArray: string[] = [];
    if (plan.features) {
      try {
        featuresArray = JSON.parse(plan.features);
      } catch (e) {
        featuresArray = [];
      }
    }

    const addOnFeatures: PublicPlanFeatureDto[] =
      plan.plan_features?.map((pf: any) => ({
        code: pf.features?.code || '',
        name: pf.features?.name || '',
        priceMonthly: Number(pf.features?.price_monthly || 0),
      })) || [];

    const includedAddOns: PublicPlanAddonDto[] =
      plan.plan_addons
        ?.filter((pa: any) => !!pa.add_ons && Number(pa.add_ons.is_active) === 1)
        .map((pa: any) => ({
          id: pa.add_ons.id,
          code: pa.add_ons.code,
          name: pa.add_ons.name,
          description: pa.add_ons.description ?? undefined,
          price: Number(pa.add_ons.price ?? 0),
          billingCycle: pa.add_ons.billing_cycle,
          category: pa.add_ons.category ?? undefined,
          icon: pa.add_ons.icon ?? undefined,
        })) || [];

    // Calculate yearly pricing (prefer explicit price, otherwise derive from %).
    const priceMonthly = Number(plan.price_monthly || 0);
    const yearlyDiscountPercent = plan.yearly_discount_percent || 0;

    let priceYearly: number | undefined;
    let yearlySavings: number | undefined;

    if (plan.price_yearly) {
      priceYearly = Number(plan.price_yearly);
    } else if (yearlyDiscountPercent > 0) {
      const monthlyTotal = priceMonthly * 12;
      priceYearly = Math.round(monthlyTotal * (1 - yearlyDiscountPercent / 100));
    }

    if (priceYearly) {
      yearlySavings = priceMonthly * 12 - priceYearly;
    }

    return {
      id: plan.id,
      code: plan.code,
      system: plan.system || 'HOTEL',
      name: plan.name,
      description: plan.description,
      priceMonthly,
      priceYearly,
      yearlyDiscountPercent: yearlyDiscountPercent > 0 ? yearlyDiscountPercent : undefined,
      yearlySavings: yearlySavings && yearlySavings > 0 ? Math.round(yearlySavings) : undefined,
      maxRooms: plan.max_rooms,
      maxUsers: plan.max_users,
      displayOrder: plan.display_order,
      isPopular: Boolean(plan.is_popular),
      badge: plan.badge,
      highlightColor: plan.highlight_color,
      features: featuresArray,
      buttonText: plan.button_text || 'เริ่มใช้งาน',
      subtitle: plan.subtitle || undefined,
      targetAudience: plan.target_audience || undefined,
      pricePerRoom: plan.price_per_room || undefined,
      addOnFeatures: addOnFeatures.length > 0 ? addOnFeatures : undefined,
      includedAddOns: includedAddOns.length > 0 ? includedAddOns : undefined,
    };
  }

  /**
   * GET /api/v1/plans/:id
   * Public endpoint to get a single plan - No authentication required
   */
  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get plan by ID',
    description: 'Public endpoint to get a single plan details',
  })
  @ApiParam({
    name: 'id',
    description: 'Plan ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Plan retrieved successfully',
    type: PublicPlanDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Plan not found',
  })
  async findOne(@Param('id') id: string): Promise<PublicPlanDto> {
    const plan = await this.plansService.findOne(id);
    return this.toPublicPlanDto(plan);
  }

  @Get('code/:code')
  @Public()
  findByCode(@Param('code') code: string) {
    return this.plansService.findByCode(code);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updatePlanDto: UpdatePlanDto) {
    return this.plansService.update(id, updatePlanDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
