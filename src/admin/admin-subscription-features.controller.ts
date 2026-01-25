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
import { AdminSubscriptionFeaturesService } from './admin-subscription-features.service';
import {
  UpdateSubscriptionFeatureDto,
  RemoveSubscriptionFeatureDto,
  AddSubscriptionFeatureDto,
  SubscriptionFeaturesListDto,
  UpdateFeatureResponseDto,
  RemoveFeatureResponseDto,
  AddFeatureResponseDto,
  FeatureLogsListDto,
} from './dto/admin-subscription-features.dto';

@ApiTags('Admin - Add-on Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/subscription-features', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminSubscriptionFeaturesController {
  constructor(
    private readonly adminSubscriptionFeaturesService: AdminSubscriptionFeaturesService,
  ) {}

  /**
   * GET /api/v1/admin/subscription-features/:subscriptionId
   * Get all add-ons for a subscription
   */
  @Get(':subscriptionId')
  @ApiOperation({
    summary: 'Get subscription add-ons',
    description: 'Get all add-ons for a specific subscription (use SUB-001 format or UUID)',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Add-ons retrieved successfully',
    type: SubscriptionFeaturesListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getSubscriptionFeatures(
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<SubscriptionFeaturesListDto> {
    return this.adminSubscriptionFeaturesService.getSubscriptionFeatures(subscriptionId);
  }

  /**
   * GET /api/v1/admin/subscription-features/:subscriptionId/logs
   * Get change logs for a subscription's add-ons
   */
  @Get(':subscriptionId/logs')
  @ApiOperation({
    summary: 'Get add-on change logs',
    description: 'Get history of add-on changes for a subscription',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription ID (SUB-001 format or UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Logs retrieved successfully',
    type: FeatureLogsListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getFeatureLogs(
    @Param('subscriptionId') subscriptionId: string,
  ): Promise<FeatureLogsListDto> {
    return this.adminSubscriptionFeaturesService.getFeatureLogs(subscriptionId);
  }

  /**
   * POST /api/v1/admin/subscription-features
   * Add a new add-on to a subscription
   */
  @Post()
  @ApiOperation({
    summary: 'Add add-on to subscription',
    description: 'Add a new add-on (feature) to a subscription with optional invoice creation',
  })
  @ApiResponse({
    status: 201,
    description: 'Add-on added successfully',
    type: AddFeatureResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request - feature already exists' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription or feature not found' })
  async addFeature(
    @Body() dto: AddSubscriptionFeatureDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<AddFeatureResponseDto> {
    return this.adminSubscriptionFeaturesService.addFeature(dto, user?.userId);
  }

  /**
   * PATCH /api/v1/admin/subscription-features/:id
   * Update an add-on (quantity/price)
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update add-on',
    description: 'Update quantity or price of an existing add-on',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription Feature ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Add-on updated successfully',
    type: UpdateFeatureResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription feature not found' })
  async updateFeature(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionFeatureDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<UpdateFeatureResponseDto> {
    return this.adminSubscriptionFeaturesService.updateFeature(id, dto, user?.userId);
  }

  /**
   * POST /api/v1/admin/subscription-features/:id/remove
   * Remove an add-on with optional credit
   */
  @Post(':id/remove')
  @ApiOperation({
    summary: 'Remove add-on',
    description: 'Remove an add-on from subscription with optional credit for unused portion',
  })
  @ApiParam({
    name: 'id',
    description: 'Subscription Feature ID (UUID)',
  })
  @ApiResponse({
    status: 200,
    description: 'Add-on removed successfully',
    type: RemoveFeatureResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Subscription feature not found' })
  async removeFeature(
    @Param('id') id: string,
    @Body() dto: RemoveSubscriptionFeatureDto,
    @CurrentUser() user: { userId?: string },
  ): Promise<RemoveFeatureResponseDto> {
    return this.adminSubscriptionFeaturesService.removeFeature(id, dto, user?.userId);
  }
}
