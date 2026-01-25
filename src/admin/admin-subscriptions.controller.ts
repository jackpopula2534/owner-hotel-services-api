import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
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
import { AdminSubscriptionsService } from './admin-subscriptions.service';
import {
  AdminSubscriptionsQueryDto,
  AdminSubscriptionsListResponseDto,
  AdminSubscriptionsSummaryDto,
  AdminSubscriptionDetailDto,
  UpdateSubscriptionStatusDto,
  SubscriptionStatusUpdateResponseDto,
} from './dto/admin-subscriptions.dto';

@ApiTags('Admin - Subscriptions Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/subscriptions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminSubscriptionsController {
  constructor(
    private readonly adminSubscriptionsService: AdminSubscriptionsService,
  ) {}

  /**
   * GET /api/v1/admin/subscriptions
   * Get all subscriptions with filtering, search, and pagination
   */
  @Get()
  @ApiOperation({
    summary: 'Get all subscriptions',
    description:
      'Retrieve a paginated list of all subscriptions with optional filtering by status and search',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscriptions retrieved successfully',
    type: AdminSubscriptionsListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  async findAll(
    @Query() query: AdminSubscriptionsQueryDto,
  ): Promise<AdminSubscriptionsListResponseDto> {
    return this.adminSubscriptionsService.findAll(query);
  }

  /**
   * GET /api/v1/admin/subscriptions/summary
   * Get subscriptions summary for dashboard
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Get subscriptions summary',
    description:
      'Retrieve summary data including Active count, Trial count, MRR, Upgrades, Downgrades',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary retrieved successfully',
    type: AdminSubscriptionsSummaryDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  async getSummary(): Promise<AdminSubscriptionsSummaryDto> {
    return this.adminSubscriptionsService.getSummary();
  }

  /**
   * GET /api/v1/admin/subscriptions/:id
   * Get subscription detail by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get subscription detail',
    description:
      'Retrieve detailed information for a specific subscription (use SUB-001 format or UUID)',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription detail retrieved successfully',
    type: AdminSubscriptionDetailDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async findOne(@Param('id') id: string): Promise<AdminSubscriptionDetailDto> {
    return this.adminSubscriptionsService.findOne(id);
  }

  /**
   * PATCH /api/v1/admin/subscriptions/:id/status
   * Update subscription status
   */
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update subscription status',
    description:
      'Change the status of a subscription (active, pending, cancelled, expired)',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription status updated successfully',
    type: SubscriptionStatusUpdateResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires platform_admin role',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionStatusDto,
  ): Promise<SubscriptionStatusUpdateResponseDto> {
    return this.adminSubscriptionsService.updateStatus(id, dto);
  }
}
