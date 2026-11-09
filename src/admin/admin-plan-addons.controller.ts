import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { AdminPlanAddonsService } from './admin-plan-addons.service';
import { AssignAddonToPlanDto, PlanAddonsResponseDto } from './dto/admin-plan-addons.dto';

@ApiTags('Admin - Plan Add-ons Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/plans', version: '1' })
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminPlanAddonsController {
  constructor(private readonly adminPlanAddonsService: AdminPlanAddonsService) {}

  /**
   * GET /api/v1/admin/plans/:planId/addons
   * Returns assigned + available Add-ons for a plan.
   */
  @Get(':planId/addons')
  @ApiOperation({
    summary: 'Get plan add-ons',
    description:
      'Retrieve assigned add-ons and available add-ons for a plan. Mirrors the plan-features endpoint shape.',
  })
  @ApiParam({ name: 'planId', description: 'Plan ID (UUID)' })
  @ApiResponse({ status: 200, type: PlanAddonsResponseDto })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  async getPlanAddons(@Param('planId') planId: string): Promise<PlanAddonsResponseDto> {
    return this.adminPlanAddonsService.getPlanAddons(planId);
  }

  /**
   * POST /api/v1/admin/plans/:planId/addons
   * Assign an add-on to a plan. Returns the refreshed assigned/available list.
   */
  @Post(':planId/addons')
  @ApiOperation({
    summary: 'Assign add-on to plan',
    description: 'Assign an add-on to a plan. Prevents duplicates automatically.',
  })
  @ApiParam({ name: 'planId', description: 'Plan ID (UUID)' })
  @ApiResponse({ status: 201, type: PlanAddonsResponseDto })
  @ApiResponse({ status: 404, description: 'Plan or add-on not found' })
  @ApiResponse({ status: 409, description: 'Add-on already assigned to plan' })
  async assignAddonToPlan(
    @Param('planId') planId: string,
    @Body() dto: AssignAddonToPlanDto,
  ): Promise<PlanAddonsResponseDto> {
    return this.adminPlanAddonsService.assignAddonToPlan(planId, dto);
  }

  /**
   * DELETE /api/v1/admin/plans/:planId/addons/:addonId
   * Remove an add-on from a plan.
   */
  @Delete(':planId/addons/:addonId')
  @ApiOperation({
    summary: 'Remove add-on from plan',
    description: 'Remove an add-on assignment from a plan.',
  })
  @ApiParam({ name: 'planId', description: 'Plan ID (UUID)' })
  @ApiParam({ name: 'addonId', description: 'Add-on ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Add-on removed successfully' })
  @ApiResponse({ status: 404, description: 'Plan, add-on, or assignment not found' })
  async removeAddonFromPlan(
    @Param('planId') planId: string,
    @Param('addonId') addonId: string,
  ): Promise<{ message: string }> {
    return this.adminPlanAddonsService.removeAddonFromPlan(planId, addonId);
  }
}
