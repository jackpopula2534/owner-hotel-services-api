import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { RestaurantAnalyticsService } from './analytics.service';
import { RestaurantDailySalesService } from './daily-sales.service';
import { RestaurantMonthlySalesService } from './monthly-sales.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Restaurant Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@Controller('restaurants/:restaurantId/analytics')
export class RestaurantAnalyticsController {
  constructor(
    private readonly analyticsService: RestaurantAnalyticsService,
    private readonly dailySalesService: RestaurantDailySalesService,
    private readonly monthlySalesService: RestaurantMonthlySalesService,
  ) {}

  @Get('monthly-sales')
  @ApiOperation({
    summary: 'Monthly sales overview for one outlet (Bangkok calendar month)',
    description:
      'The month view behind the sales dashboard: the same receipt-reconcilable totals as ' +
      'daily-sales aggregated over the month, a per-day row for every calendar day (zeros ' +
      'included, used to drill into daily-sales), payment/order-type splits, top items and a ' +
      'previous-month comparison. Counts only COMPLETED + PAID orders, keyed on completedAt ' +
      'inside an Asia/Bangkok month.',
  })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant ID' })
  @ApiQuery({
    name: 'month',
    required: false,
    description: 'Bangkok calendar month (YYYY-MM). Defaults to the current month.',
    example: '2026-08',
  })
  @ApiResponse({ status: 200, description: 'Monthly sales report' })
  @ApiResponse({ status: 404, description: 'Restaurant not found for this tenant' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'accountant')
  async getMonthlySales(
    @Param('restaurantId') restaurantId: string,
    @Query('month') month?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.monthlySalesService.getMonthlySales(restaurantId, user!.tenantId, month);
  }

  @Get('daily-sales')
  @ApiOperation({
    summary: 'Daily sales report for one outlet (Bangkok calendar day)',
    description:
      'Receipt-reconcilable revenue for a single day: gross/net sales, discount, service ' +
      'charge, tax and collected total, plus payment/order-type splits, an hourly curve, ' +
      'top items and a previous-day comparison. Counts only COMPLETED + PAID orders, keyed ' +
      'on completedAt inside an Asia/Bangkok day.',
  })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant ID' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Bangkok calendar day (YYYY-MM-DD). Defaults to today.',
    example: '2026-08-14',
  })
  @ApiResponse({ status: 200, description: 'Daily sales report' })
  @ApiResponse({ status: 404, description: 'Restaurant not found for this tenant' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'accountant')
  async getDailySales(
    @Param('restaurantId') restaurantId: string,
    @Query('date') date?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.dailySalesService.getDailySales(restaurantId, user!.tenantId, date);
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue summary with timeline breakdown' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant ID' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date (ISO 8601)',
    example: '2026-04-01',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date (ISO 8601)',
    example: '2026-04-30',
  })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    enum: ['day', 'week', 'month'],
    description: 'Time grouping for timeline',
  })
  @ApiResponse({
    status: 200,
    description: 'Revenue summary with timeline, payment breakdown, and order type breakdown',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'accountant')
  async getRevenueSummary(
    @Param('restaurantId') restaurantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.analyticsService.getRevenueSummary(restaurantId, user!.tenantId, {
      from,
      to,
      groupBy,
    });
  }

  @Get('daily-summary')
  @ApiOperation({ summary: 'Get operational summary for a specific day' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Date (ISO 8601)',
    example: '2026-04-10',
  })
  @ApiResponse({
    status: 200,
    description: 'Daily summary: revenue, orders, guests, kitchen, table stats',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'accountant')
  async getDailySummary(
    @Param('restaurantId') restaurantId: string,
    @Query('date') date?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.analyticsService.getDailySummary(restaurantId, user!.tenantId, date);
  }

  @Get('top-items')
  @ApiOperation({ summary: 'Get top-selling menu items by quantity' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items (default 10)',
    example: 10,
  })
  @ApiResponse({ status: 200, description: 'Ranked menu items with quantity and revenue data' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'accountant')
  async getTopMenuItems(
    @Param('restaurantId') restaurantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.analyticsService.getTopMenuItems(restaurantId, user!.tenantId, {
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('table-utilization')
  @ApiOperation({ summary: 'Get per-table utilization and revenue stats' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiResponse({
    status: 200,
    description: 'Per-table stats: orders served, revenue, avg turnover time',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'accountant')
  async getTableUtilization(
    @Param('restaurantId') restaurantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.analyticsService.getTableUtilization(restaurantId, user!.tenantId, { from, to });
  }

  @Get('hourly-heatmap')
  @ApiOperation({ summary: 'Get order heatmap by day-of-week and hour' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiResponse({
    status: 200,
    description: 'Heatmap grid: orders and revenue per [dayOfWeek, hour] cell',
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'accountant')
  async getHourlyHeatmap(
    @Param('restaurantId') restaurantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: { tenantId: string },
  ) {
    return this.analyticsService.getHourlyHeatmap(restaurantId, user!.tenantId, { from, to });
  }
}
