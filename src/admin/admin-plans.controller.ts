import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminPlansService } from './admin-plans.service';
import {
  AdminPlansListDto,
  CreatePlanDto,
  UpdatePlanDto,
  PlanResponseDto,
  AssignFeatureToPlanDto,
  PlanFeaturesResponseDto,
} from './dto/admin-plans.dto';

@ApiTags('Admin - Plans Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/plans', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminPlansController {
  constructor(private readonly adminPlansService: AdminPlansService) {}

  /**
   * GET /api/v1/admin/plans
   * Get all subscription plans
   */
  @Get()
  @ApiOperation({
    summary: 'Get all subscription plans',
    description:
      'Retrieve all available subscription plans with statistics (subscription count, feature count)',
  })
  @ApiResponse({
    status: 200,
    description: 'Plans retrieved successfully',
    type: AdminPlansListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  async findAll(): Promise<AdminPlansListDto> {
    return this.adminPlansService.findAll();
  }

  /**
   * GET /api/v1/admin/plans/:id
   * Get plan by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get plan detail',
    description:
      'Retrieve detailed information for a specific plan including features and subscription count',
  })
  @ApiParam({
    name: 'id',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiResponse({
    status: 200,
    description: 'Plan detail retrieved successfully',
    type: PlanResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async findOne(@Param('id') id: string): Promise<PlanResponseDto> {
    return this.adminPlansService.findOne(id);
  }

  /**
   * POST /api/v1/admin/plans
   * Create a new plan
   */
  @Post()
  @ApiOperation({
    summary: 'Create new plan',
    description: 'Create a new subscription plan. Plan code must be unique (e.g., S, M, L)',
  })
  @ApiResponse({
    status: 201,
    description: 'Plan created successfully',
    type: PlanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - plan code already exists',
  })
  async create(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.adminPlansService.create(dto);
  }

  /**
   * PATCH /api/v1/admin/plans/:id
   * Update a plan
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update plan',
    description:
      'Update an existing plan. Warning: Reducing limits may affect active subscriptions.',
  })
  @ApiParam({
    name: 'id',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiResponse({
    status: 200,
    description: 'Plan updated successfully',
    type: PlanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async update(@Param('id') id: string, @Body() dto: UpdatePlanDto): Promise<PlanResponseDto> {
    return this.adminPlansService.update(id, dto);
  }

  /**
   * DELETE /api/v1/admin/plans/:id
   * Delete a plan
   */
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete plan',
    description:
      'Delete a plan (soft delete by setting isActive to false). Cannot delete plans with active subscriptions.',
  })
  @ApiParam({
    name: 'id',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiResponse({
    status: 200,
    description: 'Plan deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Plan "Medium Plan" deleted successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - plan has active subscriptions',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.adminPlansService.remove(id);
  }

  /**
   * GET /api/v1/admin/plans/:planId/features
   * Get all features for a plan (assigned + available)
   */
  @Get(':planId/features')
  @ApiOperation({
    summary: 'Get plan features',
    description:
      'Retrieve assigned features and available features for a plan. Helps admins see what features are already assigned and what can be added.',
  })
  @ApiParam({
    name: 'planId',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiResponse({
    status: 200,
    description: 'Plan features retrieved successfully',
    type: PlanFeaturesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async getPlanFeatures(@Param('planId') planId: string): Promise<PlanFeaturesResponseDto> {
    return this.adminPlansService.getPlanFeatures(planId);
  }

  /**
   * POST /api/v1/admin/plans/:planId/features
   * Assign a feature to a plan
   */
  @Post(':planId/features')
  @ApiOperation({
    summary: 'Assign feature to plan',
    description: 'Assign a feature to a plan. Prevents duplicates automatically.',
  })
  @ApiParam({
    name: 'planId',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiResponse({
    status: 201,
    description: 'Feature assigned to plan successfully',
    type: PlanResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad Request - validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict - feature already assigned to plan',
  })
  @ApiResponse({ status: 404, description: 'Plan or feature not found' })
  async assignFeatureToPlan(
    @Param('planId') planId: string,
    @Body() dto: AssignFeatureToPlanDto,
  ): Promise<PlanResponseDto> {
    return this.adminPlansService.assignFeatureToPlan(planId, dto);
  }

  /**
   * DELETE /api/v1/admin/plans/:planId/features/:featureId
   * Remove a feature from a plan
   */
  @Delete(':planId/features/:featureId')
  @ApiOperation({
    summary: 'Remove feature from plan',
    description: 'Remove a feature from a plan by deleting the plan_features record.',
  })
  @ApiParam({
    name: 'planId',
    description: 'Plan ID (UUID)',
    example: 'uuid-1234',
  })
  @ApiParam({
    name: 'featureId',
    description: 'Feature ID (UUID)',
    example: 'uuid-5678',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature removed from plan successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Feature "Extra Analytics" removed from plan "Medium Plan" successfully',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Plan, feature, or plan-feature assignment not found' })
  async removeFeatureFromPlan(
    @Param('planId') planId: string,
    @Param('featureId') featureId: string,
  ): Promise<{ message: string }> {
    return this.adminPlansService.removeFeatureFromPlan(planId, featureId);
  }
}
