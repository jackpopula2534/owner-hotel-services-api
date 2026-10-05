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
  HttpCode,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService, AVATAR_MAX_BYTES } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { SetUserExpirationDto } from './dto/set-user-expiration.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';

type CallerUser = {
  id?: string;
  tenantId?: string;
  role?: string;
};

function getCallerContext(req: Request, user: CallerUser) {
  return {
    callerId: user?.id,
    callerRole: user?.role,
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
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
  async findAll(@Query() query: AdminListUsersQueryDto, @CurrentUser() user: CallerUser) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findAll(query, tenantId);
  }

  // --------------------------------------------------------------------------
  // Self-service (/users/me) — any logged-in user, own account only.
  // Declared before the `:id` routes so "me" is never read as a user id.
  // --------------------------------------------------------------------------

  @Get('me')
  @ApiOperation({ summary: 'Get my own profile' })
  @ApiResponse({ status: 200, description: 'Profile of the logged-in user' })
  async getMe(@CurrentUser() user: CallerUser) {
    return this.usersService.getMyProfile(user.id, user.tenantId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my own name and phone' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  async updateMe(@Body() dto: UpdateMyProfileDto, @CurrentUser() user: CallerUser) {
    return this.usersService.updateMyProfile(user.id, dto, user.tenantId);
  }

  @Post('me/avatar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Upload my profile picture (JPG, PNG or WebP, max 2 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Profile with the new avatarUrl' })
  @ApiResponse({ status: 400, description: 'Missing, oversized or unsupported file' })
  @UseInterceptors(
    FileInterceptor('avatar', { storage: memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } }),
  )
  async uploadMyAvatar(
    @UploadedFile() file: { buffer: Buffer; size?: number } | undefined,
    @CurrentUser() user: CallerUser,
  ) {
    return this.usersService.setMyAvatar(user.id, file, user.tenantId);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Remove my profile picture' })
  @ApiResponse({ status: 200, description: 'Profile without an avatar' })
  async removeMyAvatar(@CurrentUser() user: CallerUser) {
    return this.usersService.removeMyAvatar(user.id, user.tenantId);
  }

  @Post('me/password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change my own password' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Current password is wrong' })
  async changeMyPassword(@Body() dto: ChangeMyPasswordDto, @CurrentUser() user: CallerUser) {
    return this.usersService.changeMyPassword(user.id, dto, user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async findOne(@Param('id') id: string, @CurrentUser() user: CallerUser) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findOneDetailed(id, tenantId);
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
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.update(id, updateUserDto, tenantId, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: CallerUser) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
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
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.updateStatus(id, dto, tenantId, getCallerContext(req, user));
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
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.suspend(id, dto, tenantId, getCallerContext(req, user));
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'เปิดใช้งานผู้ใช้ (กลับเป็น active)' })
  @ApiResponse({ status: 200, description: 'User activated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async activate(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: CallerUser) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.activate(id, tenantId, getCallerContext(req, user));
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'ปิดใช้งานผู้ใช้ชั่วคราว (inactive)' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async deactivate(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: CallerUser) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.deactivate(id, tenantId, getCallerContext(req, user));
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
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.setExpiration(id, dto, tenantId, getCallerContext(req, user));
  }
}
