import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CostReportsService } from './cost-reports.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';

@ApiTags('Cost Accounting - Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@Controller({ path: 'cost-accounting/reports', version: '1' })
export class CostReportsController {
  constructor(private readonly costReportsService: CostReportsService) {}

  @Get('department-pnl')
  @ApiOperation({ summary: 'Get USALI department P&L report' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, example: '2026-04' })
  @ApiResponse({ status: 200, description: 'Department P&L retrieved' })
  async getDepartmentPnL(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.costReportsService.getDepartmentPnL(
      req.user.tenantId,
      propertyId,
      period,
    );
    return { success: true, data };
  }

  @Get('room-cost')
  @ApiOperation({ summary: 'Get room cost per night analysis' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, example: '2026-04' })
  @ApiResponse({ status: 200, description: 'Room cost analysis retrieved' })
  async getRoomCostReport(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.costReportsService.getRoomCostReport(
      req.user.tenantId,
      propertyId,
      period,
    );
    return { success: true, data };
  }

  @Get('food-cost')
  @ApiOperation({ summary: 'Get food cost % analysis by menu item' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, example: '2026-04' })
  @ApiResponse({ status: 200, description: 'Food cost analysis retrieved' })
  async getFoodCostReport(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.costReportsService.getFoodCostReport(
      req.user.tenantId,
      propertyId,
      period,
    );
    return { success: true, data };
  }

  @Get('trend')
  @ApiOperation({ summary: 'Get multi-period cost trend' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'periods', required: false, example: '12' })
  @ApiResponse({ status: 200, description: 'Cost trend retrieved' })
  async getCostTrend(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
    @Query('periods') periodsStr?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const periods = parseInt(periodsStr, 10) || 12;
    const data = await this.costReportsService.getCostTrend(req.user.tenantId, propertyId, periods);
    return { success: true, data };
  }

  @Get('budget-variance')
  @ApiOperation({ summary: 'Get budget vs actual variance report' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'period', required: true, example: '2026-04' })
  @ApiResponse({ status: 200, description: 'Budget variance report retrieved' })
  async getBudgetVarianceReport(
    @Req() req: { user: { tenantId: string } },
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.costReportsService.getBudgetVarianceReport(
      req.user.tenantId,
      propertyId,
      period,
    );
    return { success: true, data };
  }
}
