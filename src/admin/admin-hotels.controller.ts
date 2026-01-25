import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
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
import { AdminHotelsService } from './admin-hotels.service';
import {
  AdminHotelsQueryDto,
  AdminHotelsListResponseDto,
  AdminHotelsSummaryDto,
  AdminHotelDetailDto,
  UpdateHotelStatusDto,
  HotelStatusUpdateResponseDto,
  SendHotelNotificationDto,
  HotelNotificationResponseDto,
} from './dto/admin-hotels.dto';

@ApiTags('Admin - Hotels Management')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/hotels', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class AdminHotelsController {
  constructor(private readonly adminHotelsService: AdminHotelsService) {}

  /**
   * GET /api/v1/admin/hotels
   * Get all hotels with filtering, search, and pagination
   */
  @Get()
  @ApiOperation({
    summary: 'Get all hotels',
    description:
      'Retrieve a paginated list of all hotels with optional filtering by status and search',
  })
  @ApiResponse({
    status: 200,
    description: 'Hotels retrieved successfully',
    type: AdminHotelsListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  async findAll(
    @Query() query: AdminHotelsQueryDto,
  ): Promise<AdminHotelsListResponseDto> {
    return this.adminHotelsService.findAll(query);
  }

  /**
   * GET /api/v1/admin/hotels/summary
   * Get hotels summary by status
   */
  @Get('summary')
  @ApiOperation({
    summary: 'Get hotels summary',
    description:
      'Retrieve summary counts of hotels grouped by status (Active, Trial, Expired, Suspended)',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary retrieved successfully',
    type: AdminHotelsSummaryDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  async getSummary(): Promise<AdminHotelsSummaryDto> {
    return this.adminHotelsService.getSummary();
  }

  /**
   * GET /api/v1/admin/hotels/:id
   * Get hotel detail by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get hotel detail',
    description: 'Retrieve detailed information for a specific hotel',
  })
  @ApiParam({ name: 'id', description: 'Hotel ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Hotel detail retrieved successfully',
    type: AdminHotelDetailDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Hotel not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminHotelDetailDto> {
    return this.adminHotelsService.findOne(id);
  }

  /**
   * PATCH /api/v1/admin/hotels/:id/status
   * Update hotel status (suspend/activate)
   */
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update hotel status',
    description: 'Change the status of a hotel (e.g., suspend, activate)',
  })
  @ApiParam({ name: 'id', description: 'Hotel ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Hotel status updated successfully',
    type: HotelStatusUpdateResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Hotel not found' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHotelStatusDto,
  ): Promise<HotelStatusUpdateResponseDto> {
    return this.adminHotelsService.updateStatus(id, dto);
  }

  /**
   * POST /api/v1/admin/hotels/:id/notify
   * Send notification email to hotel owner
   */
  @Post(':id/notify')
  @ApiOperation({
    summary: 'Send notification to hotel',
    description: 'Send a notification email to the hotel owner',
  })
  @ApiParam({ name: 'id', description: 'Hotel ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Notification sent successfully',
    type: HotelNotificationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires platform_admin role' })
  @ApiResponse({ status: 404, description: 'Hotel not found' })
  async sendNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendHotelNotificationDto,
  ): Promise<HotelNotificationResponseDto> {
    return this.adminHotelsService.sendNotification(id, dto);
  }
}
