import { Controller, Get, Post, Body, Query, UseGuards, Req, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { KpiSnapshotsService } from './kpi-snapshots.service';
import { QueryKpiSnapshotDto, GenerateDailySnapshotDto } from './dto/query-kpi-snapshot.dto';

@ApiTags('Cost Accounting - KPI Snapshots')
@Controller({ path: 'cost-accounting/kpi-snapshots', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@ApiBearerAuth()
export class KpiSnapshotsController {
  constructor(private readonly kpiSnapshotsService: KpiSnapshotsService) {}

  @Post('generate-daily')
  @ApiOperation({ summary: 'Generate or update daily KPI snapshot' })
  @ApiResponse({
    status: 200,
    description: 'Daily snapshot generated successfully',
  })
  async generateDaily(
    @Body() dto: GenerateDailySnapshotDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const snapshot = await this.kpiSnapshotsService.generateDailySnapshot(req.user.tenantId, dto);
    return {
      success: true,
      data: snapshot,
    };
  }

  @Get('today')
  @ApiOperation({ summary: 'Get today KPI snapshot' })
  @ApiResponse({ status: 200, description: 'Today KPI snapshot retrieved' })
  async getToday(
    @Query('propertyId') propertyId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const snapshot = await this.kpiSnapshotsService.getSnapshot(
      req.user.tenantId,
      propertyId,
      today,
      'daily',
    );

    return {
      success: true,
      data: snapshot,
    };
  }

  @Get('range')
  @ApiOperation({ summary: 'Get KPI snapshots in date range' })
  @ApiResponse({
    status: 200,
    description: 'KPI snapshots in range retrieved',
  })
  async getRange(
    @Query() query: QueryKpiSnapshotDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[]; meta: any }> {
    const { data, total } = await this.kpiSnapshotsService.getRange(req.user.tenantId, query);

    return {
      success: true,
      data,
      meta: { total },
    };
  }

  @Post('monthly/:period')
  @ApiOperation({
    summary: 'Calculate and save monthly KPI snapshot (YYYY-MM format)',
  })
  @ApiResponse({
    status: 200,
    description: 'Monthly snapshot calculated successfully',
  })
  async calculateMonthly(
    @Query('propertyId') propertyId: string,
    @Query('period') period: string, // YYYY-MM
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const snapshot = await this.kpiSnapshotsService.calculateMonthlyKpi(
      req.user.tenantId,
      propertyId,
      period,
    );

    return {
      success: true,
      data: snapshot,
    };
  }
}
