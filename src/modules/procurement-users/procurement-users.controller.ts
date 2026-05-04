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
import { ProcurementUsersService } from './procurement-users.service';
import { CreateProcurementUserDto } from './dto/create-procurement-user.dto';
import { UpdateProcurementUserDto } from './dto/update-procurement-user.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** Tenant admins, managers and procurement managers may administer users. */
const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'platform_admin',
  'admin',
  'procurement_manager',
]);

@ApiTags('Procurement - Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'procurement/users', version: '1' })
export class ProcurementUsersController {
  constructor(private readonly service: ProcurementUsersService) {}

  private assertManager(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException(
        'Only tenant admins and procurement managers can manage procurement users',
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
  @ApiOperation({ summary: 'Create a procurement user account' })
  @ApiResponse({ status: 201, description: 'Procurement user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(@Body() dto: CreateProcurementUserDto, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.create(dto, this.assertTenant(caller));
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List all procurement users in the current tenant' })
  @ApiResponse({ status: 200, description: 'List of procurement users' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findAll(this.assertTenant(caller));
  }

  @Get('stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Aggregate stats for procurement users' })
  async stats(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.stats(this.assertTenant(caller));
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get a procurement user by ID' })
  async findOne(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findOne(userId, this.assertTenant(caller));
  }

  @Patch(':userId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Update role, status, password, approval limit, or permissions' })
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateProcurementUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.update(userId, this.assertTenant(caller), dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable (soft-delete) a procurement user' })
  async remove(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.remove(userId, this.assertTenant(caller));
  }
}
