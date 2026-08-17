import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';
import { BusinessOverview, BusinessOverviewService } from './business-overview.service';

interface CurrentUserType {
  tenantId?: string;
  defaultPropertyId?: string;
}

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'dashboard', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly businessOverviewService: BusinessOverviewService,
  ) {}

  @Get('business-overview')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  @ApiOperation({
    summary: 'Get a cross-system overview of every module the tenant is entitled to',
    description:
      'Reports today revenue and outstanding work for the hotel plus F&B, inventory, ' +
      'procurement, accounting, cost accounting, HR and the campground. Each module carries ' +
      'an `entitlement`: `owned` (live tile) or `lapsed` — no longer entitled, but the ledger ' +
      'holds money it earned in the window, so the money is reported and the operational ' +
      'half is left off. Modules with neither entitlement nor money are omitted entirely. ' +
      'Headline revenue is the ledger total for the tenant, so it never moves with ' +
      'entitlements. Figures are cut on the Bangkok (UTC+7) calendar day.',
  })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    type: 'string',
    description: "Property to scope to (defaults to the user's default property)",
  })
  @ApiResponse({ status: 200, description: 'Business overview retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Role not permitted to read the overview' })
  async getBusinessOverview(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
  ): Promise<BusinessOverview> {
    return this.businessOverviewService.getBusinessOverview(
      user.tenantId,
      propertyId || user.defaultPropertyId,
    );
  }

  @Get('today-actions')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  @ApiOperation({ summary: 'Get today action items for dashboard' })
  @ApiResponse({ status: 200, description: 'Today actions retrieved successfully' })
  async getTodayActions(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
  ): Promise<{
    checkInsDue: number;
    checkOutsDue: number;
    roomsToClean: number;
    pendingPayments: number;
    checkIns: Array<{
      id: string;
      guestName: string;
      roomNumber: string;
      checkIn: Date;
      status: string;
    }>;
    checkOuts: Array<{
      id: string;
      guestName: string;
      roomNumber: string;
      checkOut: Date;
      status: string;
    }>;
  }> {
    return this.dashboardService.getTodayActions(
      user.tenantId,
      propertyId || user.defaultPropertyId,
    );
  }

  @Get('metrics')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  @ApiOperation({ summary: 'Get KPI metrics (occupancy, ADR, RevPAR, revenue)' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getMetrics(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
  ): Promise<{
    occupancyRate: number;
    occupancyTrend: number;
    adr: number;
    adrTrend: number;
    revpar: number;
    todayRevenue: number;
    revenueTrend: number;
    totalRooms: number;
    occupiedRooms: number;
    availableRooms: number;
    arrivalsToday: number;
    departuresToday: number;
    inHouseGuests: number;
  }> {
    return this.dashboardService.getMetrics(user.tenantId, propertyId || user.defaultPropertyId);
  }

  @Get('timeline')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist')
  @ApiOperation({ summary: 'Get today timeline (arrivals/departures sorted by time)' })
  @ApiResponse({ status: 200, description: 'Timeline retrieved successfully' })
  async getTimeline(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
  ): Promise<{
    events: Array<{
      id: string;
      type: 'check-in' | 'check-out';
      time: Date;
      guestName: string;
      roomNumber: string;
      bookingId: string;
      status: string;
    }>;
  }> {
    return this.dashboardService.getTimeline(user.tenantId, propertyId || user.defaultPropertyId);
  }

  @Get('room-heatmap')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist', 'staff')
  @ApiOperation({ summary: 'Get room status summary grouped by floor' })
  @ApiResponse({ status: 200, description: 'Room heatmap retrieved successfully' })
  async getRoomHeatmap(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
  ): Promise<{
    floors: Array<{
      floor: number;
      rooms: Array<{
        id: string;
        number: string;
        type: string;
        status: string;
        guestName?: string;
      }>;
    }>;
    summary: {
      vacantClean: number;
      vacantDirty: number;
      occupied: number;
      outOfOrder: number;
      total: number;
    };
  }> {
    return this.dashboardService.getRoomHeatmap(
      user.tenantId,
      propertyId || user.defaultPropertyId,
    );
  }

  @Get('activity-feed')
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'receptionist', 'staff')
  @ApiOperation({ summary: 'Get recent activity feed' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: 'number',
    description: 'Max items to return (default: 20)',
  })
  @ApiResponse({ status: 200, description: 'Activity feed retrieved successfully' })
  async getActivityFeed(
    @CurrentUser() user: CurrentUserType,
    @Query('propertyId') propertyId?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    activities: Array<{
      id: string;
      type: string;
      message: string;
      timestamp: Date;
      metadata?: Record<string, unknown>;
    }>;
  }> {
    return this.dashboardService.getActivityFeed(
      user.tenantId,
      propertyId || user.defaultPropertyId,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
