import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MobileApiService } from './mobile-api.service';
import {
  MobilePaginationDto,
  MobileDashboardDto,
  MobileBookingSummaryDto,
  MobileRoomSummaryDto,
  MobileGuestSummaryDto,
  MobileAppConfigDto,
} from './dto/mobile.dto';

@ApiTags('Mobile API')
@Controller('api/v1/mobile')
export class MobileApiController {
  constructor(private readonly mobileApiService: MobileApiService) {}

  /**
   * Get app configuration (no auth required)
   */
  @Get('config')
  @ApiOperation({ summary: 'Get mobile app configuration' })
  @ApiResponse({ status: 200, type: MobileAppConfigDto })
  getAppConfig(): MobileAppConfigDto {
    return this.mobileApiService.getAppConfig();
  }

  /**
   * Get dashboard data
   */
  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get mobile dashboard data' })
  @ApiResponse({ status: 200, type: MobileDashboardDto })
  async getDashboard(@CurrentUser() user: any): Promise<MobileDashboardDto> {
    return this.mobileApiService.getDashboard(user.tenantId);
  }

  /**
   * Get bookings list
   */
  @Get('bookings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookings list (lightweight)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200 })
  async getBookings(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.mobileApiService.getBookings(
      user.tenantId,
      { page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20 },
      status,
    );
  }

  /**
   * Get rooms list
   */
  @Get('rooms')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get rooms list (lightweight)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200 })
  async getRooms(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    return this.mobileApiService.getRooms(
      user.tenantId,
      { page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20 },
      status,
    );
  }

  /**
   * Get guests list
   */
  @Get('guests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get guests list (lightweight)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200 })
  async getGuests(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.mobileApiService.getGuests(
      user.tenantId,
      { page: page ? Number(page) : 1, limit: limit ? Number(limit) : 20 },
      search,
    );
  }

  /**
   * Quick search across all entities
   */
  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quick search across bookings, guests, and rooms' })
  @ApiQuery({ name: 'q', required: true, type: String })
  @ApiResponse({ status: 200 })
  async quickSearch(
    @CurrentUser() user: any,
    @Query('q') query: string,
  ) {
    return this.mobileApiService.quickSearch(user.tenantId, query);
  }

  /**
   * Update room status (quick action)
   */
  @Patch('rooms/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quick update room status' })
  @ApiResponse({ status: 200, type: MobileRoomSummaryDto })
  async updateRoomStatus(
    @CurrentUser() user: any,
    @Param('id') roomId: string,
    @Body('status') status: string,
  ): Promise<MobileRoomSummaryDto> {
    return this.mobileApiService.updateRoomStatus(user.tenantId, roomId, status);
  }

  /**
   * Update booking status (quick action)
   */
  @Patch('bookings/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quick update booking status' })
  @ApiResponse({ status: 200, type: MobileBookingSummaryDto })
  async updateBookingStatus(
    @CurrentUser() user: any,
    @Param('id') bookingId: string,
    @Body('status') status: string,
  ): Promise<MobileBookingSummaryDto> {
    return this.mobileApiService.updateBookingStatus(
      user.tenantId,
      bookingId,
      status,
    );
  }

  /**
   * Check-in booking (quick action)
   */
  @Post('bookings/:id/checkin')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quick check-in for booking' })
  @ApiResponse({ status: 200, type: MobileBookingSummaryDto })
  async checkIn(
    @CurrentUser() user: any,
    @Param('id') bookingId: string,
  ): Promise<MobileBookingSummaryDto> {
    return this.mobileApiService.updateBookingStatus(
      user.tenantId,
      bookingId,
      'checked_in',
    );
  }

  /**
   * Check-out booking (quick action)
   */
  @Post('bookings/:id/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quick check-out for booking' })
  @ApiResponse({ status: 200, type: MobileBookingSummaryDto })
  async checkOut(
    @CurrentUser() user: any,
    @Param('id') bookingId: string,
  ): Promise<MobileBookingSummaryDto> {
    return this.mobileApiService.updateBookingStatus(
      user.tenantId,
      bookingId,
      'checked_out',
    );
  }
}
