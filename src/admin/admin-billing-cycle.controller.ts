import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminBillingCycleService } from './admin-billing-cycle.service';
import {
  UpdateBillingCycleDto,
  RenewSubscriptionDto,
  CancelRenewalDto,
  BillingCycleResponseDto,
  RenewSubscriptionResponseDto,
  CancelRenewalResponseDto,
  BillingHistoryListDto,
  SubscriptionBillingInfoDto,
} from './dto/admin-billing-cycle.dto';

@ApiTags('Admin - Billing Cycle Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/subscriptions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminBillingCycleController {
  constructor(
    private readonly adminBillingCycleService: AdminBillingCycleService,
  ) {}

  /**
   * GET /api/v1/admin/subscriptions/:id/billing-info
   * Get subscription billing information
   */
  @Get(':id/billing-info')
  @ApiOperation({
    summary: 'Get billing info',
    description: 'Get detailed billing information for a subscription',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Billing info retrieved successfully',
    type: SubscriptionBillingInfoDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getBillingInfo(
    @Param('id') id: string,
  ): Promise<SubscriptionBillingInfoDto> {
    return this.adminBillingCycleService.getBillingInfo(id);
  }

  /**
   * GET /api/v1/admin/subscriptions/:id/billing-history
   * Get billing history for a subscription
   */
  @Get(':id/billing-history')
  @ApiOperation({
    summary: 'Get billing history',
    description: 'Get history of all billing events for a subscription',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Billing history retrieved successfully',
    type: BillingHistoryListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getBillingHistory(
    @Param('id') id: string,
  ): Promise<BillingHistoryListDto> {
    return this.adminBillingCycleService.getBillingHistory(id);
  }

  /**
   * PATCH /api/v1/admin/subscriptions/:id/billing-cycle
   * Update billing cycle (monthly <-> yearly)
   */
  @Patch(':id/billing-cycle')
  @ApiOperation({
    summary: 'Update billing cycle',
    description: 'Change subscription billing cycle between monthly and yearly',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Billing cycle updated successfully',
    type: BillingCycleResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - subscription cancelled or same cycle' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async updateBillingCycle(
    @Param('id') id: string,
    @Body() dto: UpdateBillingCycleDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<BillingCycleResponseDto> {
    return this.adminBillingCycleService.updateBillingCycle(id, dto, user?.userId);
  }

  /**
   * POST /api/v1/admin/subscriptions/:id/renew
   * Manual renewal of subscription
   */
  @Post(':id/renew')
  @ApiOperation({
    summary: 'Renew subscription',
    description: 'Manually renew a subscription with optional custom period and price',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 201,
    description: 'Subscription renewed successfully',
    type: RenewSubscriptionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - subscription cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async renewSubscription(
    @Param('id') id: string,
    @Body() dto: RenewSubscriptionDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<RenewSubscriptionResponseDto> {
    return this.adminBillingCycleService.renewSubscription(id, dto, user?.userId);
  }

  /**
   * POST /api/v1/admin/subscriptions/:id/cancel-renewal
   * Cancel auto-renewal or cancel subscription
   */
  @Post(':id/cancel-renewal')
  @ApiOperation({
    summary: 'Cancel renewal',
    description: 'Cancel auto-renewal or immediately cancel subscription with optional credit',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 201,
    description: 'Renewal cancelled successfully',
    type: CancelRenewalResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - subscription already cancelled' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancelRenewal(
    @Param('id') id: string,
    @Body() dto: CancelRenewalDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<CancelRenewalResponseDto> {
    return this.adminBillingCycleService.cancelRenewal(id, dto, user?.userId);
  }
}
