import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HotelTerminalUsersService } from './hotel-terminal-users.service';
import { CreateHotelTerminalUserDto } from './dto/create-hotel-terminal-user.dto';
import { UpdateHotelTerminalUserDto } from './dto/update-hotel-terminal-user.dto';
import { ImportFromEmployeeDto } from './dto/import-from-employee.dto';
import { BulkImportFromEmployeesDto } from './dto/bulk-import-from-employees.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** Tenant admins, managers and hotel managers may administer hotel terminal users. */
const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'MANAGER',
  'platform_admin',
  'admin',
  'super_admin',
  'hotel_manager',
]);

@ApiTags('Hotel Terminal - Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'hotel-terminal/users', version: '1' })
export class HotelTerminalUsersController {
  constructor(private readonly service: HotelTerminalUsersService) {}

  private assertManager(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException(
        'Only tenant admins and hotel managers can manage hotel terminal users',
      );
    }
  }

  private assertTenant(caller: AuthenticatedCaller): string {
    if (!caller.tenantId) {
      throw new ForbiddenException('No active tenant');
    }
    return caller.tenantId;
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({ summary: 'Create a hotel terminal user account' })
  @ApiResponse({ status: 201, description: 'Hotel terminal user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(
    @Body() dto: CreateHotelTerminalUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.create(dto, this.assertTenant(caller));
  }

  @Post('import-from-employee')
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @ApiOperation({
    summary: 'Auto-create a hotel terminal user from an HR Employee record',
    description:
      'Looks up the Employee.id within the caller\'s tenant, then creates a ' +
      'User with the employee\'s name and email. Requires the HR add-on to ' +
      'have employees in the database.',
  })
  @ApiResponse({ status: 201, description: 'User imported successfully' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  @ApiResponse({ status: 409, description: 'A user with that email already exists' })
  async importFromEmployee(
    @Body() dto: ImportFromEmployeeDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.importFromEmployee(dto, this.assertTenant(caller));
  }

  @Post('import-bulk')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({
    summary: 'Bulk-import multiple HR employees as hotel terminal users',
    description:
      'Creates many users in one shot using a shared default password. ' +
      'Returns per-row created/skipped lists so the UI can show a summary. ' +
      'Skips employees that are missing, deleted, or whose email is already a user.',
  })
  @ApiResponse({ status: 201, description: 'Bulk import processed' })
  async importBulk(
    @Body() dto: BulkImportFromEmployeesDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.bulkImportFromEmployees(dto, this.assertTenant(caller));
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List all hotel terminal users in the current tenant' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findAll(this.assertTenant(caller));
  }

  @Get('stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Aggregate stats for hotel terminal users' })
  async stats(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.stats(this.assertTenant(caller));
  }

  @Get('importable-employees')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary:
      'List HR Employees that can be imported into the hotel terminal as users',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by firstName/lastName/email/employeeCode/position',
  })
  @ApiQuery({
    name: 'department',
    required: false,
    type: String,
    description: 'Filter by department name (exact match)',
  })
  async listImportable(
    @CurrentUser() caller: AuthenticatedCaller,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('department') department?: string,
  ) {
    this.assertManager(caller);
    // Pass the full caller so the service can fall back to UserTenant
    // memberships when the primary JWT tenantId has no HR rows.
    return this.service.listImportableEmployees({
      userId: caller.userId,
      tenantId: this.assertTenant(caller),
      page: page ? Math.max(1, parseInt(page, 10) || 1) : 1,
      limit: limit
        ? Math.min(200, Math.max(1, parseInt(limit, 10) || 20))
        : 20,
      search: search?.trim() || undefined,
      department: department?.trim() || undefined,
    });
  }

  @Get('importable-employees/departments')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary:
      'Distinct department names available in HR (for the import filter)',
  })
  async listImportableDepartments(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.listImportableEmployeeDepartments({
      userId: caller.userId,
      tenantId: this.assertTenant(caller),
    });
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get a hotel terminal user by ID' })
  async findOne(
    @Param('userId') userId: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.findOne(userId, this.assertTenant(caller));
  }

  @Patch(':userId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({
    summary: 'Update role, status, password, property, or permissions',
  })
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateHotelTerminalUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.update(userId, this.assertTenant(caller), dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable (soft-delete) a hotel terminal user' })
  async remove(
    @Param('userId') userId: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.remove(userId, this.assertTenant(caller));
  }
}
