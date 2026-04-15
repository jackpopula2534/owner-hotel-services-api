import { Controller, Get, Query, UseGuards, Req, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DemandForecastService } from './demand-forecast.service';
import {
  ForecastRequestDto,
  WeeklyForecastRequestDto,
  OccupancyForecastRequestDto,
  DemandForecastResponseDto,
  OccupancyForecastResponseDto,
} from './dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { AddonGuard } from '@/common/guards/addon.guard';
import { RequireAddon } from '@/common/decorators/require-addon.decorator';

interface RequestWithUser extends Request {
  user: {
    tenantId: string;
    [key: string]: any;
  };
}

@ApiTags('Inventory - Demand Forecast')
@Controller({
  path: 'inventory/demand-forecast',
  version: '1',
})
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
@ApiBearerAuth()
export class DemandForecastController {
  constructor(private readonly demandForecastService: DemandForecastService) {}

  @Get('/weekly')
  @ApiOperation({
    summary: 'Get 7-day inventory demand forecast',
    description:
      'Analyzes bookings for the next 7 days and predicts inventory needs based on room types and amenity templates',
  })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Weekly demand forecast generated successfully',
    type: DemandForecastResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid property ID or missing parameters',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User lacks INVENTORY_MODULE addon',
  })
  async getWeeklyForecast(
    @Query() query: WeeklyForecastRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<DemandForecastResponseDto> {
    return this.demandForecastService.forecastWeekly(req.user.tenantId, query.propertyId);
  }

  @Get('/monthly')
  @ApiOperation({
    summary: 'Get 30-day inventory demand forecast',
    description: 'Analyzes bookings for the next 30 days and predicts inventory needs',
  })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Monthly demand forecast generated successfully',
    type: DemandForecastResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid property ID or missing parameters',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User lacks INVENTORY_MODULE addon',
  })
  async getMonthlyForecast(
    @Query() query: WeeklyForecastRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<DemandForecastResponseDto> {
    return this.demandForecastService.forecastMonthly(req.user.tenantId, query.propertyId);
  }

  @Get('/custom')
  @ApiOperation({
    summary: 'Get custom date range inventory demand forecast',
    description: 'Analyzes bookings for a custom date range and predicts inventory needs',
  })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Start date (ISO 8601 format)',
    example: '2026-04-15',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'End date (ISO 8601 format)',
    example: '2026-05-15',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Custom demand forecast generated successfully',
    type: DemandForecastResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid parameters or date range',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User lacks INVENTORY_MODULE addon',
  })
  async getCustomForecast(
    @Query() query: ForecastRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<DemandForecastResponseDto> {
    const startDate = query.startDate || new Date().toISOString().split('T')[0];
    const endDate = query.endDate || new Date().toISOString().split('T')[0];

    return this.demandForecastService.forecastByDateRange(
      req.user.tenantId,
      query.propertyId,
      startDate,
      endDate,
    );
  }

  @Get('/occupancy')
  @ApiOperation({
    summary: 'Get occupancy forecast',
    description: 'Analyzes bookings and provides occupancy statistics for a date range',
  })
  @ApiQuery({
    name: 'propertyId',
    required: true,
    description: 'Property ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Start date (ISO 8601 format)',
    example: '2026-04-15',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'End date (ISO 8601 format)',
    example: '2026-04-22',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Occupancy forecast generated successfully',
    type: OccupancyForecastResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid parameters or date range',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid authentication token',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User lacks INVENTORY_MODULE addon',
  })
  async getOccupancyForecast(
    @Query() query: OccupancyForecastRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<OccupancyForecastResponseDto> {
    return this.demandForecastService.getOccupancyForecast(
      req.user.tenantId,
      query.propertyId,
      query.startDate,
      query.endDate,
    );
  }
}
