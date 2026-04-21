import { Controller, Get, Post, Body, Param, Query, UseGuards, Req, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { CostEntriesService } from './cost-entries.service';
import { CreateCostEntryDto } from './dto/create-cost-entry.dto';
import { QueryCostEntryDto } from './dto/query-cost-entry.dto';

@ApiTags('Cost Accounting - Cost Entries')
@Controller({ path: 'cost-accounting/cost-entries', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@ApiBearerAuth()
export class CostEntriesController {
  constructor(private readonly costEntriesService: CostEntriesService) {}

  @Get()
  @ApiOperation({ summary: 'List cost entries with filters' })
  @ApiResponse({ status: 200, description: 'Cost entries retrieved successfully' })
  async findAll(
    @Query() query: QueryCostEntryDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any; meta: any }> {
    const { data, total, page, limit } = await this.costEntriesService.findAll(
      req.user.tenantId,
      query,
    );
    return {
      success: true,
      data,
      meta: { page, limit, total },
    };
  }

  @Get('summary/:period')
  @ApiOperation({ summary: 'Get cost entries summary by period' })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  async getSummaryByPeriod(
    @Param('period') period: string,
    @Query('propertyId') propertyId: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const summary = await this.costEntriesService.getSummaryByPeriod(
      req.user.tenantId,
      propertyId,
      period,
    );
    return {
      success: true,
      data: summary,
    };
  }

  @Get('trend')
  @ApiOperation({ summary: 'Get monthly trend for cost entries' })
  @ApiResponse({ status: 200, description: 'Trend data retrieved successfully' })
  async getMonthlyTrend(
    @Query('propertyId') propertyId: string,
    @Query('months') months: string = '12',
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[] }> {
    const trend = await this.costEntriesService.getMonthlyTrend(
      req.user.tenantId,
      propertyId,
      parseInt(months, 10),
    );
    return {
      success: true,
      data: trend,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cost entry by ID' })
  @ApiResponse({ status: 200, description: 'Cost entry retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Cost entry not found' })
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const entry = await this.costEntriesService.findOne(id, req.user.tenantId);
    return {
      success: true,
      data: entry,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual cost entry' })
  @ApiResponse({ status: 201, description: 'Cost entry created successfully' })
  async create(
    @Body() createCostEntryDto: CreateCostEntryDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const entry = await this.costEntriesService.create(
      createCostEntryDto,
      req.user.id,
      req.user.tenantId,
    );
    return {
      success: true,
      data: entry,
    };
  }

  @Post('batch')
  @ApiOperation({ summary: 'Create multiple cost entries in batch' })
  @ApiResponse({ status: 201, description: 'Cost entries created successfully' })
  async createBatch(
    @Body() createCostEntriesDtos: CreateCostEntryDto[],
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[] }> {
    const entries = await this.costEntriesService.createBatch(
      createCostEntriesDtos,
      req.user.id,
      req.user.tenantId,
    );
    return {
      success: true,
      data: entries,
    };
  }

  @Post(':id/reverse')
  @ApiOperation({ summary: 'Reverse a cost entry' })
  @ApiResponse({ status: 201, description: 'Cost entry reversed successfully' })
  @ApiResponse({ status: 404, description: 'Cost entry not found' })
  async reverse(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const entry = await this.costEntriesService.reverse(id, req.user.id, req.user.tenantId);
    return {
      success: true,
      data: entry,
    };
  }
}
