import { Controller, Get, Query, Param, UseGuards, Request, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log.dto';

@ApiTags('Audit Logs')
@Controller({ path: 'audit-logs', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Get audit logs with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  async getLogs(@Query() query: AuditLogQueryDto, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.auditLogService.getLogs(query, tenantId);
  }

  @Get('stats')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Get audit log statistics' })
  @ApiResponse({ status: 200, description: 'Audit log statistics retrieved' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO string)' })
  async getStats(
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Request() req: any,
  ) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.auditLogService.getStats({ startDate, endDate }, tenantId);
  }

  @Get('export')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Export audit logs to CSV' })
  @ApiResponse({ status: 200, description: 'CSV file downloaded' })
  async exportLogs(@Query() query: AuditLogQueryDto, @Request() req: any, @Res() res: Response) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    const csv = await this.auditLogService.exportLogs(query, tenantId);

    const filename = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(HttpStatus.OK).send(csv);
  }

  @Get(':id')
  @Roles('platform_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Get audit log by ID' })
  @ApiResponse({ status: 200, description: 'Audit log retrieved' })
  async getLogById(@Param('id') id: string, @Request() req: any) {
    const tenantId = req.user?.role === 'platform_admin' ? undefined : req.user?.tenantId;
    return this.auditLogService.getLogById(id, tenantId);
  }
}
