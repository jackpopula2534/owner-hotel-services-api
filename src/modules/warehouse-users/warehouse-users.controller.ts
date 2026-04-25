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
import { WarehouseUsersService } from './warehouse-users.service';
import { CreateWarehouseUserDto } from './dto/create-warehouse-user.dto';
import { UpdateWarehouseUserDto } from './dto/update-warehouse-user.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** Tenant admins, managers and warehouse managers may administer warehouse users. */
const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'platform_admin',
  'admin',
  'warehouse_manager',
]);

@ApiTags('Warehouse - Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'warehouse/users', version: '1' })
export class WarehouseUsersController {
  constructor(private readonly service: WarehouseUsersService) {}

  private assertManager(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException(
        'Only tenant admins and warehouse managers can manage warehouse users',
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
  @ApiOperation({ summary: 'Create a warehouse user account' })
  @ApiResponse({ status: 201, description: 'Warehouse user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(
    @Body() dto: CreateWarehouseUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.create(dto, this.assertTenant(caller));
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List all warehouse users in the current tenant' })
  @ApiResponse({ status: 200, description: 'List of warehouse users' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findAll(this.assertTenant(caller));
  }

  @Get('stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Aggregate stats for warehouse users' })
  async stats(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.stats(this.assertTenant(caller));
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get a warehouse user by ID' })
  async findOne(
    @Param('userId') userId: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.findOne(userId, this.assertTenant(caller));
  }

  @Patch(':userId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Update role, status, password, permissions, or warehouseIds' })
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateWarehouseUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.update(userId, this.assertTenant(caller), dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable (soft-delete) a warehouse user' })
  async remove(
    @Param('userId') userId: string,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.remove(userId, this.assertTenant(caller));
  }
}
