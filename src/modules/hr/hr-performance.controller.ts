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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { HrPerformanceService } from './hr-performance.service';
import { CreateHrPerformanceDto, UpdateHrPerformanceDto } from './dto/create-hr-performance.dto';
import {
  SavePerformanceDraftDto,
  RejectPerformanceDto,
  BulkApproveDto,
} from './dto/update-hr-performance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / performance')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/performance', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrPerformanceController {
  constructor(private readonly performanceService: HrPerformanceService) {}

  // ─── Summary ──────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get performance summary (avg score, grade/status breakdown)' })
  @ApiQuery({ name: 'period', required: false, type: String })
  @ApiQuery({ name: 'periodType', required: false, enum: ['quarterly', 'half_yearly', 'yearly'] })
  @ApiResponse({ status: 200, description: 'Performance summary' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getSummary(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.performanceService.getSummary(query, user.tenantId!);
  }

  // ─── List & Detail ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all performance reviews' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'employeeId', required: false, type: String })
  @ApiQuery({ name: 'period', required: false, type: String })
  @ApiQuery({ name: 'periodType', required: false, enum: ['quarterly', 'half_yearly', 'yearly'] })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated performance reviews' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.performanceService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get performance review by ID' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.performanceService.findOne(id, user.tenantId!);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new performance review' })
  @ApiResponse({ status: 201, description: 'Performance review created' })
  @ApiResponse({ status: 409, description: 'Review for this employee & period already exists' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(@Body() dto: CreateHrPerformanceDto, @CurrentUser() user: { tenantId?: string }) {
    return this.performanceService.create(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a performance review' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance review updated' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrPerformanceDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.performanceService.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a performance review' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance review deleted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.performanceService.remove(id, user.tenantId!);
  }

  // ─── New Dynamic Score Endpoints ──────────────────────────────────────────

  @Patch(':id/save-draft')
  @ApiOperation({ summary: 'บันทึกคะแนน KPI (dynamic per template criteria) — status → draft' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Draft saved with recalculated overall score' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async saveDraft(
    @Param('id') id: string,
    @Body() dto: SavePerformanceDraftDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.performanceService.saveDraft(id, dto, user.tenantId!);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'ส่งให้อนุมัติ — status: draft → submitted' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance submitted for approval' })
  @ApiResponse({ status: 400, description: 'กรอกคะแนนไม่ครบ' })
  @ApiResponse({ status: 409, description: 'status ไม่ถูกต้อง' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async submit(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.performanceService.submit(id, user.tenantId!);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'อนุมัติผลการประเมิน — status: submitted → approved (Manager only)' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance approved' })
  @ApiResponse({ status: 409, description: 'status ไม่ใช่ submitted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string; id?: string; email?: string },
  ) {
    const approvedBy = user.id ?? user.email ?? 'system';
    return this.performanceService.approve(id, user.tenantId!, approvedBy);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'ปฏิเสธผลการประเมิน — status: submitted → rejected (Manager only)' })
  @ApiParam({ name: 'id', description: 'Performance record ID' })
  @ApiResponse({ status: 200, description: 'Performance rejected' })
  @ApiResponse({ status: 409, description: 'status ไม่ใช่ submitted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectPerformanceDto,
    @CurrentUser() user: { tenantId?: string; id?: string; email?: string },
  ) {
    const rejectedBy = user.id ?? user.email ?? 'system';
    return this.performanceService.reject(id, dto, user.tenantId!, rejectedBy);
  }

  @Post('bulk-approve')
  @ApiOperation({ summary: 'อนุมัติหลายรายการพร้อมกัน (Manager only)' })
  @ApiResponse({ status: 200, description: '{ approved: N, skipped: M }' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async bulkApprove(
    @Body() dto: BulkApproveDto,
    @CurrentUser() user: { tenantId?: string; id?: string; email?: string },
  ) {
    const approvedBy = user.id ?? user.email ?? 'system';
    return this.performanceService.bulkApprove(dto, user.tenantId!, approvedBy);
  }
}
