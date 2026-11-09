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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantUsersService } from './tenant-users.service';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { PutAccessDto } from './dto/put-access.dto';
import { BulkAccessDto } from './dto/bulk-access.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ImportEmployeesDto } from './dto/import-employees.dto';
import {
  ImportableEmployeesQueryDto,
  ListTenantUsersQueryDto,
} from './dto/list-tenant-users-query.dto';
import type { ActorContext } from './tenant-users.types';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** ผู้ที่จัดการผู้ใช้ของ tenant ได้ (ตาม API contract) */
const ADMIN_ROLES = new Set(['tenant_admin', 'manager', 'MANAGER', 'platform_admin', 'admin']);

const WRITE_THROTTLE = { default: { limit: 30, ttl: 60 } };
const BULK_THROTTLE = { default: { limit: 10, ttl: 60 } };
const READ_THROTTLE = { default: { limit: 60, ttl: 60 } };

@ApiTags('Tenant Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'tenant-users', version: '1' })
export class TenantUsersController {
  constructor(private readonly service: TenantUsersService) {}

  /**
   * ทุก endpoint (รวม read) จำกัดไว้ที่ผู้ดูแล — รายชื่อผู้ใช้ทั้ง tenant พร้อมอีเมล/เบอร์
   * ไม่ควรเปิดให้พนักงานทั่วไปดึงได้
   */
  private actor(caller: AuthenticatedCaller, req?: Request): ActorContext {
    if (!caller?.tenantId) throw new ForbiddenException('No active tenant');
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException('Only tenant admins and managers can manage users');
    }
    return {
      userId: caller.userId,
      tenantId: caller.tenantId,
      role: caller.role,
      email: caller.email,
      ip: req?.ip ?? req?.socket?.remoteAddress,
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  @Get()
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'List users in the current tenant with their terminal grants' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'terminal', required: false })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  list(@Query() query: ListTenantUsersQueryDto, @CurrentUser() caller: AuthenticatedCaller) {
    return this.service.list(this.actor(caller).tenantId, query);
  }

  @Get('stats')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Seat usage and user health stats' })
  stats(@CurrentUser() caller: AuthenticatedCaller) {
    return this.service.stats(this.actor(caller).tenantId);
  }

  @Get('terminals')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Terminal registry with availability for this tenant' })
  terminals(@CurrentUser() caller: AuthenticatedCaller) {
    return this.service.terminals(this.actor(caller).tenantId);
  }

  @Get('matrix')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Access matrix: terminals × users' })
  matrix(@CurrentUser() caller: AuthenticatedCaller) {
    return this.service.matrix(this.actor(caller).tenantId);
  }

  @Get('audit')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Tenant-wide user-management audit trail' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  audit(@CurrentUser() caller: AuthenticatedCaller, @Query('limit') limit?: string) {
    const take = limit ? parseInt(limit, 10) || 50 : 50;
    return this.service.audit(this.actor(caller).tenantId, take);
  }

  @Get('importable-employees')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'HR employees that can be imported as users' })
  importableEmployees(
    @Query() query: ImportableEmployeesQueryDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    return this.service.importableEmployees(this.actor(caller).tenantId, query);
  }

  @Get(':id')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Get one user with grants' })
  findOne(@Param('id') id: string, @CurrentUser() caller: AuthenticatedCaller) {
    return this.service.findOne(id, this.actor(caller).tenantId);
  }

  @Get(':id/audit')
  @Throttle(READ_THROTTLE)
  @ApiOperation({ summary: 'Audit trail for one user' })
  userAudit(@Param('id') id: string, @CurrentUser() caller: AuthenticatedCaller) {
    return this.service.audit(this.actor(caller).tenantId, 100, id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Create a user and grant terminals in one request' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @ApiResponse({ status: 403, description: 'SEAT_LIMIT_REACHED' })
  create(
    @Body() dto: CreateTenantUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.create(dto, this.actor(caller, req));
  }

  @Post('import-employees')
  @Throttle(BULK_THROTTLE)
  @ApiOperation({ summary: 'Bulk-import HR employees as users with grants' })
  importEmployees(
    @Body() dto: ImportEmployeesDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.importEmployees(dto, this.actor(caller, req));
  }

  @Post('bulk-access')
  @HttpCode(HttpStatus.OK)
  @Throttle(BULK_THROTTLE)
  @ApiOperation({ summary: 'Grant / revoke one terminal for many users' })
  bulkAccess(
    @Body() dto: BulkAccessDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.bulkAccess(dto, this.actor(caller, req));
  }

  @Patch(':id')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Update profile fields / password / expiry' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.update(id, dto, this.actor(caller, req));
  }

  @Put(':id/access')
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Replace all terminal grants for a user' })
  @ApiResponse({ status: 403, description: 'Owner rows cannot be edited' })
  replaceAccess(
    @Param('id') id: string,
    @Body() dto: PutAccessDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.replaceAccess(id, dto.grants, this.actor(caller, req));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Suspend a user on every terminal (reason required)' })
  suspend(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.suspend(id, dto.reason, this.actor(caller, req));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Re-activate a suspended / inactive user' })
  activate(
    @Param('id') id: string,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.activate(id, this.actor(caller, req));
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Set or generate a new password' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() caller: AuthenticatedCaller,
    @Req() req: Request,
  ) {
    return this.service.resetPassword(id, dto?.password, this.actor(caller, req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Soft-delete (status inactive)' })
  remove(@Param('id') id: string, @CurrentUser() caller: AuthenticatedCaller, @Req() req: Request) {
    return this.service.remove(id, this.actor(caller, req));
  }
}
