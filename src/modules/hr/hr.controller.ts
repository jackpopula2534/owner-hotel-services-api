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
} from '@nestjs/swagger';
import { HrService } from './hr.service';
import { EmployeeCodeConfigService } from './employee-code-config.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpsertEmployeeCodeConfigDto, PreviewEmployeeCodeDto } from './dto/employee-code-config.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly employeeCodeConfigService: EmployeeCodeConfigService,
  ) {}

  // ─── Employee Code Config routes ─────────────────────────────────────────
  // IMPORTANT: These MUST be declared BEFORE @Get(':id') to prevent NestJS
  // from treating "employee-code-config" as an employee ID.

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
      'Returns totalEmployees, todayAttendance, onLeave, pendingLeaveRequests, and attendanceRate. ' +
      'Pass hotelId query param to filter by specific property.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics',
    schema: {
      example: {
        totalEmployees: 12,
        todayAttendance: 8,
        onLeave: 2,
        pendingLeaveRequests: 1,
        attendanceRate: 67,
      },
    },
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async getDashboardStats(
    @Query('hotelId') hotelId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.getDashboardStats(user?.tenantId, hotelId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all employees (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new employee (requires HR add-on)' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async create(
    @Body() createEmployeeDto: CreateEmployeeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.create(createEmployeeDto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.update(id, updateEmployeeDto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete employee (requires HR add-on)' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.hrService.remove(id, user?.tenantId);
  }

  /**
   * HR Add-on bridge: create a Staff record from an existing Employee.
   * The new Staff is linked to this Employee via staffEmployee FK.
   */
  @Post(':id/create-staff')
  @ApiOperation({
    summary: 'Create Staff record from Employee (requires HR add-on)',
    description:
      'Provisions a linked Staff entry for this Employee so they appear in housekeeping/maintenance scheduling.',
  })
  @ApiParam({ name: 'id', description: 'Employee ID' })
  @ApiResponse({ status: 201, description: 'Staff record created and linked' })
  @ApiResponse({ status: 409, description: 'Employee already has a linked Staff record' })
  @ApiResponse({ status: 403, description: 'HR add-on not active' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async createStaffFromEmployee(
    @Param('id') id: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.hrService.createStaffFromEmployee(id, user?.tenantId);
  }
}
