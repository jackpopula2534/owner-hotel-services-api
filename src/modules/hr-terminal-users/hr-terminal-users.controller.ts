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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HrTerminalUsersService } from './hr-terminal-users.service';
import { CreateHrTerminalUserDto } from './dto/create-hr-terminal-user.dto';
import { UpdateHrTerminalUserDto } from './dto/update-hr-terminal-user.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** Roles that may administer HR terminal users. */
const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'platform_admin',
  'admin',
  'hr_manager',
  'MANAGER',
  'SUPER_ADMIN',
  'ADMIN',
]);

@ApiTags('HR - Terminal Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'hr/users', version: '1' })
export class HrTerminalUsersController {
  constructor(private readonly service: HrTerminalUsersService) {}

  private assertManager(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException('Only tenant admins and HR managers can manage HR users');
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
  @ApiOperation({ summary: 'Create an HR terminal user account' })
  @ApiResponse({ status: 201, description: 'HR user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(@Body() dto: CreateHrTerminalUserDto, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.create(dto, this.assertTenant(caller));
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List all HR terminal users in the current tenant' })
  @ApiResponse({ status: 200, description: 'List of HR users' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findAll(this.assertTenant(caller));
  }

  @Get('stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Aggregate stats for HR terminal users' })
  async stats(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.stats(this.assertTenant(caller));
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get an HR terminal user by ID' })
  async findOne(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findOne(userId, this.assertTenant(caller));
  }

  @Patch(':userId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Update role, status, password, or permissions' })
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateHrTerminalUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.update(userId, this.assertTenant(caller), dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable (soft-delete) an HR terminal user' })
  async remove(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.remove(userId, this.assertTenant(caller));
  }
}
