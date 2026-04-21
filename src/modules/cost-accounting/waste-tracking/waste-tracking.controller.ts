import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Version,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';
import { WasteTrackingService } from './waste-tracking.service';
import { CreateWasteRecordDto } from './dto/create-waste-record.dto';
import { QueryWasteDto } from './dto/query-waste.dto';

@ApiTags('Cost Accounting - Waste Tracking')
@Controller({ path: 'cost-accounting/waste-tracking', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('COST_ACCOUNTING_MODULE')
@ApiBearerAuth()
export class WasteTrackingController {
  constructor(private readonly wasteTrackingService: WasteTrackingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 100, ttl: 60 } })
  @ApiOperation({ summary: 'Create a waste record' })
  @ApiResponse({
    status: 201,
    description: 'Waste record created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: 404,
    description: 'Property, warehouse, or item not found',
  })
  async create(
    @Body() createWasteRecordDto: CreateWasteRecordDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const record = await this.wasteTrackingService.create(
      createWasteRecordDto,
      req.user.id,
      req.user.tenantId,
    );
    return {
      success: true,
      data: record,
    };
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List waste records with filters' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'propertyId',
    required: false,
    type: String,
    description: 'Filter by property ID',
  })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    type: String,
    description: 'Filter by warehouse ID',
  })
  @ApiQuery({
    name: 'itemId',
    required: false,
    type: String,
    description: 'Filter by item ID',
  })
  @ApiQuery({
    name: 'reason',
    required: false,
    type: String,
    enum: [
      'expired',
      'spoiled',
      'overproduction',
      'plate_waste',
      'preparation',
      'damaged',
      'other',
    ],
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Filter by department',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date (ISO 8601)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date (ISO 8601)',
  })
  @ApiResponse({
    status: 200,
    description: 'Waste records retrieved successfully',
  })
  async findAll(
    @Query() query: QueryWasteDto,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any[]; meta: any }> {
    const { data, total, page, limit } = await this.wasteTrackingService.findAll(
      req.user.tenantId,
      query,
    );
    return {
      success: true,
      data,
      meta: { page, limit, total },
    };
  }

  @Get('summary')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Get aggregated waste summary for a property' })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    type: String,
    description: 'Property ID (UUID)',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    description: 'Start date (ISO 8601, default: 30 days ago)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    description: 'End date (ISO 8601, default: today)',
  })
  @ApiResponse({
    status: 200,
    description: 'Waste summary retrieved successfully',
  })
  async getWasteSummary(
    @Query('propertyId') propertyId: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Req() req?: any,
  ): Promise<{ success: boolean; data: any }> {
    if (!propertyId) {
      throw new BadRequestException('propertyId query parameter is required');
    }

    // Default to last 30 days
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const summary = await this.wasteTrackingService.getWasteSummary(
      req.user.tenantId,
      propertyId,
      startDate,
      endDate,
    );

    return {
      success: true,
      data: summary,
    };
  }

  @Get('top-wasted')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Get top N wasted items by value' })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    type: String,
    description: 'Property ID (UUID)',
  })
  @ApiQuery({
    name: 'period',
    required: true,
    type: String,
    description: 'Period (YYYY-MM or YYYY-MM-DD)',
    example: '2026-04',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Top N items (default 10, max 50)',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Top wasted items retrieved successfully',
  })
  async getTopWastedItems(
    @Query('propertyId') propertyId: string,
    @Query('period') period: string,
    @Query('limit') limitStr: string = '10',
    @Req() req?: any,
  ): Promise<{ success: boolean; data: any[] }> {
    if (!propertyId) {
      throw new BadRequestException('propertyId query parameter is required');
    }

    if (!period) {
      throw new BadRequestException('period query parameter is required');
    }

    let limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const items = await this.wasteTrackingService.getTopWastedItems(
      req.user.tenantId,
      propertyId,
      period,
      limit,
    );

    return {
      success: true,
      data: items,
    };
  }

  @Get('by-item/:itemId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Get waste history for a specific item' })
  @ApiParam({
    name: 'itemId',
    description: 'Inventory item ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    type: String,
    description: 'Property ID (UUID)',
  })
  @ApiQuery({
    name: 'months',
    required: false,
    type: Number,
    description: 'Number of months to look back (default 12)',
    example: 12,
  })
  @ApiResponse({
    status: 200,
    description: 'Item waste history retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Item not found',
  })
  async getWasteByItem(
    @Param('itemId') itemId: string,
    @Query('propertyId') propertyId: string,
    @Query('months') monthsStr: string = '12',
    @Req() req?: any,
  ): Promise<{ success: boolean; data: any }> {
    if (!propertyId) {
      throw new BadRequestException('propertyId query parameter is required');
    }

    let months = parseInt(monthsStr, 10);
    if (isNaN(months) || months < 1) months = 12;
    if (months > 60) months = 60;

    const history = await this.wasteTrackingService.getWasteByItem(
      req.user.tenantId,
      propertyId,
      itemId,
      months,
    );

    return {
      success: true,
      data: history,
    };
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'Get waste record by ID' })
  @ApiParam({
    name: 'id',
    description: 'Waste record ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Waste record retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Waste record not found',
  })
  async findOne(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<{ success: boolean; data: any }> {
    const record = await this.wasteTrackingService.findOne(id, req.user.tenantId);
    return {
      success: true,
      data: record,
    };
  }
}
