import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import {
  PublicPlansListDto,
  PublicPlanDto,
  PublicPlanFeatureDto,
} from './dto/public-plans.dto';

@ApiTags('Public - Plans (Sales Page)')
@Controller({ path: 'plans', version: '1' })
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
  @ApiOperation({
    summary: 'Get all active plans for Sales Page',
    description:
      'Public endpoint that returns all active subscription plans with sales page information. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Plans retrieved successfully',
    type: PublicPlansListDto,
  })
  async findAll(): Promise<PublicPlansListDto> {
    const plans = await this.plansService.findAll();

    const data: PublicPlanDto[] = plans.map((plan) => {
      // Parse features from JSON string
      let featuresArray: string[] = [];
      if (plan.features) {
        try {
          featuresArray = JSON.parse(plan.features);
        } catch (e) {
          // If not valid JSON, treat as empty array
          featuresArray = [];
        }
      }

      // Map add-on features
      const addOnFeatures: PublicPlanFeatureDto[] =
        plan.planFeatures?.map((pf) => ({
          code: pf.feature?.code || '',
          name: pf.feature?.name || '',
          priceMonthly: Number(pf.feature?.priceMonthly || 0),
        })) || [];

      // Calculate yearly pricing
      const priceMonthly = Number(plan.priceMonthly || 0);
      const yearlyDiscountPercent = plan.yearlyDiscountPercent || 0;

      let priceYearly: number | undefined;
      let yearlySavings: number | undefined;

      if (plan.priceYearly) {
        // Use explicit yearly price if provided
        priceYearly = Number(plan.priceYearly);
      } else if (yearlyDiscountPercent > 0) {
        // Calculate from discount percentage
        const monthlyTotal = priceMonthly * 12;
        priceYearly = Math.round(
          monthlyTotal * (1 - yearlyDiscountPercent / 100),
        );
      }

      if (priceYearly) {
        yearlySavings = priceMonthly * 12 - priceYearly;
      }

      return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly,
        priceYearly,
        yearlyDiscountPercent: yearlyDiscountPercent > 0 ? yearlyDiscountPercent : undefined,
        yearlySavings: yearlySavings && yearlySavings > 0 ? Math.round(yearlySavings) : undefined,
        maxRooms: plan.maxRooms,
        maxUsers: plan.maxUsers,
        displayOrder: plan.displayOrder,
        isPopular: plan.isPopular,
        badge: plan.badge,
        highlightColor: plan.highlightColor,
        features: featuresArray,
        buttonText: plan.buttonText || 'เริ่มใช้งาน',
        addOnFeatures:
          addOnFeatures.length > 0 ? addOnFeatures : undefined,
      };
    });

    return {
      data,
      total: data.length,
    };
  }

  /**
   * GET /api/v1/plans/:id
   * Public endpoint to get a single plan - No authentication required
   */
  @Get(':id')
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

    // Parse features from JSON string
    let featuresArray: string[] = [];
    if (plan.features) {
      try {
        featuresArray = JSON.parse(plan.features);
      } catch (e) {
        featuresArray = [];
      }
    }

    // Map add-on features
    const addOnFeatures: PublicPlanFeatureDto[] =
      plan.planFeatures?.map((pf) => ({
        code: pf.feature?.code || '',
        name: pf.feature?.name || '',
        priceMonthly: Number(pf.feature?.priceMonthly || 0),
      })) || [];

    // Calculate yearly pricing
    const priceMonthly = Number(plan.priceMonthly || 0);
    const yearlyDiscountPercent = plan.yearlyDiscountPercent || 0;

    let priceYearly: number | undefined;
    let yearlySavings: number | undefined;

    if (plan.priceYearly) {
      priceYearly = Number(plan.priceYearly);
    } else if (yearlyDiscountPercent > 0) {
      const monthlyTotal = priceMonthly * 12;
      priceYearly = Math.round(
        monthlyTotal * (1 - yearlyDiscountPercent / 100),
      );
    }

    if (priceYearly) {
      yearlySavings = priceMonthly * 12 - priceYearly;
    }

    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly,
      priceYearly,
      yearlyDiscountPercent: yearlyDiscountPercent > 0 ? yearlyDiscountPercent : undefined,
      yearlySavings: yearlySavings && yearlySavings > 0 ? Math.round(yearlySavings) : undefined,
      maxRooms: plan.maxRooms,
      maxUsers: plan.maxUsers,
      displayOrder: plan.displayOrder,
      isPopular: plan.isPopular,
      badge: plan.badge,
      highlightColor: plan.highlightColor,
      features: featuresArray,
      buttonText: plan.buttonText || 'เริ่มใช้งาน',
      addOnFeatures: addOnFeatures.length > 0 ? addOnFeatures : undefined,
    };
  }

  @Get('code/:code')
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


