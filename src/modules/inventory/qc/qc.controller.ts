import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { QCService } from './qc.service';
import {
  CreateQCTemplateDto,
  UpdateQCTemplateDto,
  CreateChecklistItemDto,
  CreateQCRecordDto,
  SubmitQCRecordDto,
  QueryQCRecordDto,
} from './dto/qc.dto';

@ApiTags('Inventory QC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory/qc')
export class QCController {
  constructor(private readonly qcService: QCService) {}

  // ─── Templates ───────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List all QC templates' })
  @Get('templates')
  listTemplates(@Request() req: any) {
    return this.qcService.listTemplates(req.user.tenantId);
  }

  @ApiOperation({ summary: 'Create a QC template' })
  @Post('templates')
  createTemplate(@Request() req: any, @Body() dto: CreateQCTemplateDto) {
    return this.qcService.createTemplate(req.user.tenantId, dto);
  }

  @ApiOperation({ summary: 'Update a QC template' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @Patch('templates/:id')
  updateTemplate(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateQCTemplateDto) {
    return this.qcService.updateTemplate(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Delete a QC template (cannot delete if has records)' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @Delete('templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Request() req: any, @Param('id') id: string) {
    return this.qcService.deleteTemplate(req.user.tenantId, id);
  }

  @ApiOperation({ summary: 'Add checklist item to a template' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @Post('templates/:id/items')
  addChecklistItem(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.qcService.addChecklistItem(req.user.tenantId, id, dto);
  }

  @ApiOperation({ summary: 'Remove checklist item from a template' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiParam({ name: 'itemId', description: 'Checklist item UUID' })
  @Delete('templates/:id/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeChecklistItem(
    @Request() req: any,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.qcService.removeChecklistItem(req.user.tenantId, id, itemId);
  }

  // ─── Records ─────────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List QC records with filters' })
  @Get('records')
  listRecords(@Request() req: any, @Query() query: QueryQCRecordDto) {
    return this.qcService.listRecords(req.user.tenantId, query);
  }

  @ApiOperation({ summary: 'Create a new QC record' })
  @Post('records')
  createRecord(@Request() req: any, @Body() dto: CreateQCRecordDto) {
    return this.qcService.createRecord(req.user.tenantId, dto, req.user.id);
  }

  @ApiOperation({ summary: 'Get QC record detail' })
  @ApiParam({ name: 'id', description: 'QC Record UUID' })
  @Get('records/:id')
  getRecord(@Request() req: any, @Param('id') id: string) {
    return this.qcService.getRecord(req.user.tenantId, id);
  }

  @ApiOperation({ summary: 'Submit QC record results → PASSED / PARTIAL_FAIL / FAILED' })
  @ApiParam({ name: 'id', description: 'QC Record UUID' })
  @ApiResponse({ status: 200, description: 'Record updated with status' })
  @Post('records/:id/submit')
  @HttpCode(HttpStatus.OK)
  submitRecord(@Request() req: any, @Param('id') id: string, @Body() dto: SubmitQCRecordDto) {
    return this.qcService.submitRecord(req.user.tenantId, id, dto);
  }

  // ─── Supplier quality report ──────────────────────────────────────────────────

  @ApiOperation({ summary: 'Get supplier quality report (pass rate / rejection rate)' })
  @ApiQuery({ name: 'supplierId', required: true })
  @ApiQuery({ name: 'from', required: true, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO date' })
  @Get('supplier-quality')
  getSupplierQuality(
    @Request() req: any,
    @Query('supplierId') supplierId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.qcService.getSupplierQualityReport(req.user.tenantId, supplierId, { from, to });
  }
}
