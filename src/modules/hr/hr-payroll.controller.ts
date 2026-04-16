import {
  Controller,
  Get,
  Post,
  Patch,
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
import { HrPayrollService } from './hr-payroll.service';
import { RunPayrollDto, ApprovePayrollDto } from './dto/run-payroll.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / payroll')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/payroll', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrPayrollController {
  constructor(private readonly payrollService: HrPayrollService) {}

  // ─── Summary ──────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get payroll summary for a month/year' })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Payroll totals and status breakdown' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getSummary(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.payrollService.getSummary(query, user.tenantId!);
  }

  // ─── List & Detail ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List payroll records' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'month', required: false, type: Number })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'approved', 'paid', 'cancelled'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated payroll records' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.payrollService.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payroll record by ID' })
  @ApiParam({ name: 'id', description: 'Payroll record ID' })
  @ApiResponse({ status: 200, description: 'Payroll detail with items' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.payrollService.findOne(id, user.tenantId!);
  }

  // ─── Run Payroll ──────────────────────────────────────────────────────────

  @Post('run')
  @ApiOperation({
    summary: 'Run payroll for a month/year',
    description:
      'Generates draft payroll records for all active employees (or a specified subset). ' +
      'OT pay is automatically calculated from attendance records.',
  })
  @ApiResponse({ status: 201, description: 'Payroll records created (draft status)' })
  @ApiResponse({ status: 400, description: 'No employees found or invalid period' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async runPayroll(@Body() dto: RunPayrollDto, @CurrentUser() user: { tenantId?: string }) {
    return this.payrollService.runPayroll(dto, user.tenantId!);
  }

  // ─── Workflow ─────────────────────────────────────────────────────────────

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a draft payroll record' })
  @ApiParam({ name: 'id', description: 'Payroll record ID' })
  @ApiResponse({ status: 200, description: 'Payroll approved' })
  @ApiResponse({ status: 400, description: 'Payroll is not in draft status' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApprovePayrollDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.payrollService.approve(id, dto, user.id ?? 'system', user.tenantId!);
  }

  @Patch(':id/paid')
  @ApiOperation({ summary: 'Mark payroll as paid (after bank transfer)' })
  @ApiParam({ name: 'id', description: 'Payroll record ID' })
  @ApiResponse({ status: 200, description: 'Payroll marked as paid' })
  @ApiResponse({ status: 400, description: 'Payroll must be approved first' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async markPaid(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.payrollService.markPaid(id, user.tenantId!);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a payroll record' })
  @ApiParam({ name: 'id', description: 'Payroll record ID' })
  @ApiResponse({ status: 200, description: 'Payroll cancelled' })
  @ApiResponse({ status: 400, description: 'Cannot cancel a paid payroll' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async cancel(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.payrollService.cancel(id, user.tenantId!);
  }
}
