import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { SetUserExpirationDto } from './dto/set-user-expiration.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';

type CallerUser = {
  id?: string;
  tenantId?: string;
  role?: string;
};

function getCallerContext(req: Request, user: CallerUser) {
  return {
    callerId: user?.id,
    callerRole: user?.role,
    ipAddress:
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip,
  };
}

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async findAll(
    @Query() query: AdminListUsersQueryDto,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findAll(query, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async findOne(@Param('id') id: string, @CurrentUser() user: CallerUser) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user (excluding lifecycle fields)' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: any,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.update(id, updateUserDto, tenantId, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: CallerUser) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.remove(id, tenantId);
  }

  // ==========================================================================
  // Lifecycle endpoints
  // ==========================================================================

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Change user status (active / inactive / suspended / expired)',
  })
  @ApiResponse({ status: 200, description: 'User status updated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: Request,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.updateStatus(
      id,
      dto,
      tenantId,
      getCallerContext(req, user),
    );
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'ระงับการใช้งานผู้ใช้' })
  @ApiResponse({ status: 200, description: 'User suspended' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async suspend(
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
    @Req() req: Request,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.suspend(
      id,
      dto,
      tenantId,
      getCallerContext(req, user),
    );
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'เปิดใช้งานผู้ใช้ (กลับเป็น active)' })
  @ApiResponse({ status: 200, description: 'User activated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async activate(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.activate(
      id,
      tenantId,
      getCallerContext(req, user),
    );
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'ปิดใช้งานผู้ใช้ชั่วคราว (inactive)' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async deactivate(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.deactivate(
      id,
      tenantId,
      getCallerContext(req, user),
    );
  }

  @Patch(':id/expiration')
  @ApiOperation({ summary: 'กำหนด/ยกเลิกวันหมดอายุของผู้ใช้' })
  @ApiResponse({ status: 200, description: 'User expiration updated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async setExpiration(
    @Param('id') id: string,
    @Body() dto: SetUserExpirationDto,
    @Req() req: Request,
    @CurrentUser() user: CallerUser,
  ) {
    const tenantId =
      user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.setExpiration(
      id,
      dto,
      tenantId,
      getCallerContext(req, user),
    );
  }
}
