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
import { AccountingUsersService } from './accounting-users.service';
import { CreateAccountingUserDto } from './dto/create-accounting-user.dto';
import { UpdateAccountingUserDto } from './dto/update-accounting-user.dto';

interface AuthenticatedCaller {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
}

/** Roles that may administer accounting users. */
const ADMIN_ROLES = new Set([
  'tenant_admin',
  'manager',
  'platform_admin',
  'admin',
  'chief_accountant',
  'MANAGER',
  'SUPER_ADMIN',
  'ADMIN',
]);

@ApiTags('Accounting - Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'accounting/users', version: '1' })
export class AccountingUsersController {
  constructor(private readonly service: AccountingUsersService) {}

  private assertManager(caller: AuthenticatedCaller): void {
    if (!ADMIN_ROLES.has(caller.role)) {
      throw new ForbiddenException(
        'Only tenant admins and chief accountants can manage accounting users',
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
  @ApiOperation({ summary: 'Create an accounting user account' })
  @ApiResponse({ status: 201, description: 'Accounting user created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async create(@Body() dto: CreateAccountingUserDto, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.create(dto, this.assertTenant(caller));
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60 } })
  @ApiOperation({ summary: 'List all accounting users in the current tenant' })
  @ApiResponse({ status: 200, description: 'List of accounting users' })
  async list(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findAll(this.assertTenant(caller));
  }

  @Get('stats')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Aggregate stats for accounting users' })
  async stats(@CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.stats(this.assertTenant(caller));
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get an accounting user by ID' })
  async findOne(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.findOne(userId, this.assertTenant(caller));
  }

  @Patch(':userId')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: 'Update role, status, password, or permissions' })
  async update(
    @Param('userId') userId: string,
    @Body() dto: UpdateAccountingUserDto,
    @CurrentUser() caller: AuthenticatedCaller,
  ) {
    this.assertManager(caller);
    return this.service.update(userId, this.assertTenant(caller), dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable (soft-delete) an accounting user' })
  async remove(@Param('userId') userId: string, @CurrentUser() caller: AuthenticatedCaller) {
    this.assertManager(caller);
    return this.service.remove(userId, this.assertTenant(caller));
  }
}
