import { AllowSystems } from '../../common/decorators/allow-systems.decorator';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Patch,
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
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { HrService } from './hr.service';
import { HrCompletenessService } from './hr-completeness.service';
import { HrDashboardService } from './hr-dashboard.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  UpsertEmployeeCodeConfigDto,
  PreviewEmployeeCodeDto,
} from './dto/employee-code-config.dto';
import { CreateStaffFromEmployeeDto } from './dto/create-staff-from-employee.dto';
import { BulkCreateStaffDto } from './dto/bulk-create-staff.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { maskEmployeePayroll, maskEmployeeListPayroll } from '../../common/utils/payroll-mask.util';

@ApiTags('hr')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly hrCompletenessService: HrCompletenessService,
    private readonly employeeCodeConfigService: EmployeeCodeConfigService,
    private readonly hrDashboardService: HrDashboardService,
  ) {}

  // ─── Employee Code Config routes ─────────────────────────────────────────
  // NOTE: The employee param routes below are constrained to a UUID pattern
  // (:id([0-9a-fA-F-]{36})), so static sub-resource paths — both these local
  // ones AND sibling controllers under `hr/...` (manpower-requests, candidates,
  // equipment-requests, etc.) — never get swallowed by the greedy `:id` route,
  // regardless of module registration order.

  @Get('employee-code-config')
  @ApiOperation({ summary: 'Get employee code configuration for current tenant' })
  @ApiResponse({ status: 200, description: 'Employee code config (or default if not configured)' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getEmployeeCodeConfig(@CurrentUser() user: { tenantId?: string }) {
    return this.employeeCodeConfigService.getConfig(user?.tenantId);
  }

  @Get('employee-code-config/preview')
  @ApiOperation({ summary: 'Preview the next employee code without incrementing the counter' })
  @ApiResponse({ status: 200, description: 'Preview employee code string' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async previewEmployeeCode(
    @Query() query: PreviewEmployeeCodeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    const code = await this.employeeCodeConfigService.previewNextCode(
      user?.tenantId,
      query.departmentCode,
    );
    return { code };
  }

  @Put('employee-code-config')
  @ApiOperation({ summary: 'Create or update employee code configuration' })
  @ApiResponse({ status: 200, description: 'Config saved successfully' })
  @Roles('platform_admin', 'tenant_admin', 'admin')
  async upsertEmployeeCodeConfig(
    @Body() dto: UpsertEmployeeCodeConfigDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.employeeCodeConfigService.upsertConfig(user?.tenantId, dto);
  }

  @Post('employee-code-config/reset-counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset the running number counter to 1' })
  @ApiResponse({ status: 200, description: 'Counter reset successfully' })
  @Roles('platform_admin', 'tenant_admin', 'admin')
  async resetEmployeeCodeCounter(@CurrentUser() user: { tenantId?: string }) {
    return this.employeeCodeConfigService.resetCounter(user?.tenantId);
  }

  // ─── Employee CRUD routes ─────────────────────────────────────────────────

  // IMPORTANT: Static routes (dashboard-stats) MUST be declared BEFORE @Get(':id')
  // to prevent NestJS from treating "dashboard-stats" as an employee ID.

  @Get('dashboard-stats')
  @ApiOperation({
    summary: 'Get HR dashboard statistics (requires HR add-on)',
    description:
      'Legacy summary kept for the hotel dashboard. Values come from the same calculation as ' +
      '/hr/dashboard-overview (Bangkok day, current employees only, rostered denominator).',
  })
  @ApiQuery({ name: 'hotelId', required: false, description: 'Property ID filter' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics',
    schema: {
      example: {
        totalEmployees: 52,
        todayAttendance: 36,
        onLeave: 3,
        pendingLeaveRequests: 1,
        attendanceRate: 95,
      },
    },
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getDashboardStats(
    @Query('hotelId') hotelId: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    const o = await this.hrDashboardService.getOverview(user?.tenantId, hotelId || undefined);
    return {
      totalEmployees: o.headcount.current,
      todayAttendance: o.today.present,
      onLeave: o.today.onLeave,
      pendingLeaveRequests: o.pending.leave,
      attendanceRate: o.today.attendanceRate ?? 0,
    };
  }

  @Get('dashboard-overview')
  @ApiOperation({
    summary: 'Full HR dashboard overview for today (Bangkok time)',
    description:
      'Headcount, today attendance breakdown, per-department attendance, pending approvals, ' +
      'who is away, 14-day attendance trend and upcoming HR events. ' +
      'propertyId limits to that property plus employees not tied to any property.',
  })
  @ApiQuery({ name: 'propertyId', required: false, description: 'Property ID filter' })
  @ApiResponse({ status: 200, description: 'HR dashboard overview' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getDashboardOverview(
    @Query('propertyId') propertyId: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrDashboardService.getOverview(user?.tenantId, propertyId || undefined);
  }

  @Get()
  @ApiOperation({ summary: 'Get all employees (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string; role?: string }) {
    const result = await this.hrService.findAll(query, user?.tenantId);
    return {
      ...result,
      data: maskEmployeeListPayroll(result.data as Record<string, unknown>[], user.role),
    };
  }

  @Get('completeness/summary')
  @ApiOperation({
    summary: 'Bulk employee completeness summary for list views (requires HR add-on)',
    description:
      'Returns overall completeness percentage per employee. ' +
      'Optionally filter with ?ids=id1,id2 (comma-separated).',
  })
  @ApiResponse({ status: 200, description: 'Array of { employeeId, overallPct }' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getCompletenessSummary(
    @Query('ids') ids: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    const idList = ids
      ? ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return this.hrCompletenessService.getCompletenessSummary(user?.tenantId, idList);
  }

  @Get(':id([0-9a-fA-F-]{36})/completeness')
  @ApiOperation({
    summary: 'Get employee data completeness across HR subsystems (requires HR add-on)',
    description:
      'Aggregates profile sections (6 form tabs) plus subsystem readiness ' +
      '(documents, onboarding, probation, leave policy, payroll, roster, attendance, training) ' +
      'into a single completeness score with per-item missing details.',
  })
  @ApiParam({ name: 'id', description: 'Employee ID' })
  @ApiResponse({ status: 200, description: 'Completeness summary' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getCompleteness(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrCompletenessService.getEmployeeCompleteness(id, user?.tenantId);
  }

  @Get(':id([0-9a-fA-F-]{36})')
  @ApiOperation({ summary: 'Get employee by ID (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string; role?: string },
  ) {
    const employee = await this.hrService.findOne(id, user?.tenantId);
    return maskEmployeePayroll(employee as Record<string, unknown>, user.role);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new employee (requires HR add-on)' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(
    @Body() createEmployeeDto: CreateEmployeeDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.hrService.create(createEmployeeDto, user?.tenantId, user?.id);
  }

  @Patch(':id([0-9a-fA-F-]{36})')
  @ApiOperation({ summary: 'Update employee (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.hrService.update(id, updateEmployeeDto, user?.tenantId, user?.id);
  }

  @Delete(':id([0-9a-fA-F-]{36})')
  @ApiOperation({ summary: 'Delete employee (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.remove(id, user?.tenantId);
  }

  /**
   * HR Add-on bridge: bulk-create Staff records for ALL unlinked Employees.
   * Idempotent — employees already linked to a Staff record are skipped.
   * This endpoint MUST be declared before @Post(':id/create-staff') so NestJS
   * does not mistake "bulk-create-staff" for an employee ID.
   */
  @Post('bulk-create-staff')
  @ApiOperation({
    summary: 'Bulk-create Staff records from all unlinked HR employees (requires HR add-on)',
    description:
      'ไม่ส่ง body = นำเข้าเฉพาะแผนกที่มีหน้างาน (HK, ENG) และเฉพาะพนักงานที่ยังทำงานอยู่ ' +
      'ตำแหน่งเดาจากแผนกรายคน · เรียกซ้ำได้ คนที่ผูกแล้วจะถูกข้าม ' +
      'คนที่มีอยู่บนทะเบียนแล้วจะถูกผูกเข้ากับ HR ไม่ใช่สร้างซ้ำ',
  })
  @ApiResponse({
    status: 201,
    description: 'Sync complete — returns created/skipped counts and per-employee results',
    schema: {
      example: {
        created: 2,
        skipped: 1,
        results: [
          {
            employeeId: 'emp-1',
            employeeName: 'รัตนา แม่บ้านดี',
            staffId: 'staff-123',
            status: 'created',
          },
          {
            employeeId: 'emp-2',
            employeeName: 'สุนันท์ ทำความสะอาด',
            status: 'skipped',
            reason: 'Already linked to a Staff record',
          },
        ],
      },
    },
  })
  @ApiBody({ type: BulkCreateStaffDto, required: false })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async bulkCreateStaffFromEmployees(
    @Body() body: BulkCreateStaffDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.bulkCreateStaffFromEmployees(user?.tenantId ?? '', body ?? {});
  }

  /**
   * HR Add-on bridge: create a Staff record from an existing Employee.
   * The new Staff is linked to this Employee via staffEmployee FK.
   */
  @Post(':id([0-9a-fA-F-]{36})/create-staff')
  @ApiOperation({
    summary: 'Create Staff record from Employee (requires HR add-on)',
    description:
      'Provisions a linked Staff entry for this Employee so they appear in housekeeping/maintenance scheduling. ' +
      'Pass `role` to choose between housekeeper (แม่บ้าน) and technician (ช่าง). Defaults to housekeeper.',
  })
  @ApiParam({ name: 'id', description: 'Employee ID' })
  @ApiBody({ type: CreateStaffFromEmployeeDto, required: false })
  @ApiResponse({ status: 201, description: 'Staff record created and linked' })
  @ApiResponse({ status: 409, description: 'Employee already has a linked Staff record' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async createStaffFromEmployee(
    @Param('id') id: string,
    @Body() body: CreateStaffFromEmployeeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.createStaffFromEmployee(id, user?.tenantId, body);
  }
}
