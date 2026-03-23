import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import {
  ExportRequestDto,
  ExportResponseDto,
  RevenueReportQueryDto,
  RevenueReportResponseDto,
  OccupancyReportQueryDto,
  OccupancyReportResponseDto,
} from './dto/export.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Reports')
@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export data to Excel, CSV, or PDF' })
  @ApiResponse({
    status: 200,
    description: 'Data exported successfully',
    type: ExportResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid data or format',
  })
  async exportData(@Body() dto: ExportRequestDto): Promise<ExportResponseDto> {
    return this.reportsService.exportData(dto);
  }

  @Post('export/download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export and download file directly' })
  @ApiResponse({
    status: 200,
    description: 'File download initiated',
  })
  async exportAndDownload(@Body() dto: ExportRequestDto, @Res() res: Response) {
    const result = await this.reportsService.exportData(dto);

    const buffer = Buffer.from(result.data, 'base64');

    let contentType: string;
    if (dto.format === 'excel') {
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (dto.format === 'csv') {
      contentType = 'text/csv';
    } else if (dto.format === 'pdf') {
      contentType = 'application/pdf';
    } else {
      contentType = 'application/octet-stream';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  }

  // ==========================================
  // Revenue Reports
  // ==========================================

  @Get('revenue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get revenue report with analytics' })
  @ApiResponse({
    status: 200,
    description: 'Revenue report generated successfully',
    type: RevenueReportResponseDto,
  })
  async getRevenueReport(
    @Query() query: RevenueReportQueryDto,
    @Request() req: any,
  ): Promise<RevenueReportResponseDto> {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.reportsService.getRevenueReport(query, tenantId);
  }

  // ==========================================
  // Occupancy Reports
  // ==========================================

  @Get('occupancy')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('platform_admin', 'tenant_admin', 'manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get occupancy report with analytics' })
  @ApiResponse({
    status: 200,
    description: 'Occupancy report generated successfully',
    type: OccupancyReportResponseDto,
  })
  async getOccupancyReport(
    @Query() query: OccupancyReportQueryDto,
    @Request() req: any,
  ): Promise<OccupancyReportResponseDto> {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.reportsService.getOccupancyReport(query, tenantId);
  }
}
