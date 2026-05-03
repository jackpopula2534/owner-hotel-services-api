import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DataExportService, ExportKind } from './data-export.service';

@ApiTags('Data Export / PDPA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'data-export', version: '1' })
export class DataExportController {
  constructor(private readonly service: DataExportService) {}

  // ── Tenant endpoints ──
  @Post()
  @ApiOperation({ summary: 'Request a data export for the active tenant' })
  async request(
    @CurrentUser() user: any,
    @Body() body: { kind?: ExportKind },
  ) {
    return this.service.request({
      tenantId: user.tenant_id,
      userId: user.id || user.user_id,
      kind: body.kind,
    });
  }

  @Get('mine')
  @ApiOperation({ summary: 'List recent export requests for the tenant' })
  async listMine(@CurrentUser() user: any) {
    return this.service.listForTenant(user.tenant_id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Resolve the signed download URL for a completed export' })
  async download(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const url = await this.service.getDownloadUrl(id, user.tenant_id);
    return { url };
  }

  // ── Admin endpoints ──
  @Get('admin')
  @ApiOperation({ summary: '[Admin] List export requests across tenants' })
  async listAll(
    @Query('status') status?:
      | 'queued'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'expired',
    @Query('kind') kind?: ExportKind,
    @Query('limit') limit?: string,
  ) {
    return this.service.listAll({
      status,
      kind,
      limit: limit ? parseInt(limit, 10) : 100,
    });
  }
}
