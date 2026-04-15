import { Controller, Get, Query, UseGuards, Req, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { QueryDashboardWidgetsDto } from './dto/query-dashboard-widgets.dto';

@ApiTags('Cost Accounting - Dashboard Widgets')
@Controller({ path: 'cost-accounting/dashboard', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@ApiBearerAuth()
export class DashboardWidgetsController {
  constructor(private readonly dashboardWidgetsService: DashboardWidgetsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview KPI cards' })
  @ApiResponse({
    status: 200,
    description: 'Overview cards retrieved successfully',
  })
  async getOverview(@Query('propertyId') propertyId: string, @Req() req: any): Promise<any> {
    const result = await this.dashboardWidgetsService.getOverviewCards(
      req.user.tenantId,
      propertyId,
    );

    return {
      success: result.success,
      data: result.data,
    };
  }

  @Get('charts/revenue')
  @ApiOperation({ summary: 'Get revenue breakdown chart (last N days)' })
  @ApiResponse({
    status: 200,
    description: 'Revenue chart data retrieved successfully',
  })
  async getRevenueChart(
    @Query('propertyId') propertyId: string,
    @Query('days') days: string = '30',
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const chart = await this.dashboardWidgetsService.getRevenueChart(
      req.user.tenantId,
      propertyId,
      parseInt(days, 10),
    );

    return {
      success: true,
      data: chart,
    };
  }

  @Get('charts/cost-breakdown')
  @ApiOperation({ summary: 'Get cost breakdown pie chart' })
  @ApiResponse({
    status: 200,
    description: 'Cost breakdown chart data retrieved successfully',
  })
  async getCostBreakdown(
    @Query('propertyId') propertyId: string,
    @Query('period') period: string, // YYYY-MM
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const chart = await this.dashboardWidgetsService.getCostBreakdownChart(
      req.user.tenantId,
      propertyId,
      period,
    );

    return {
      success: true,
      data: chart,
    };
  }

  @Get('charts/occupancy')
  @ApiOperation({ summary: 'Get occupancy rate trend chart' })
  @ApiResponse({
    status: 200,
    description: 'Occupancy trend chart data retrieved successfully',
  })
  async getOccupancyChart(
    @Query('propertyId') propertyId: string,
    @Query('days') days: string = '30',
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const chart = await this.dashboardWidgetsService.getOccupancyChart(
      req.user.tenantId,
      propertyId,
      parseInt(days, 10),
    );

    return {
      success: true,
      data: chart,
    };
  }

  @Get('charts/departments')
  @ApiOperation({ summary: 'Get department comparison bar chart' })
  @ApiResponse({
    status: 200,
    description: 'Department comparison chart data retrieved successfully',
  })
  async getDepartmentComparison(
    @Query('propertyId') propertyId: string,
    @Query('period') period: string, // YYYY-MM
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const chart = await this.dashboardWidgetsService.getDepartmentComparison(
      req.user.tenantId,
      propertyId,
      period,
    );

    return {
      success: true,
      data: chart,
    };
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get dashboard top alerts' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard alerts retrieved successfully',
  })
  async getTopAlerts(
    @Query('propertyId') propertyId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const alerts = await this.dashboardWidgetsService.getTopAlerts(req.user.tenantId, propertyId);

    return {
      success: true,
      data: alerts,
    };
  }
}
