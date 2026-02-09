import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string, role?: string }) {
    // Platform admin เห็นได้ทั้งหมด, tenant_admin เห็นแค่ของ tenant ตัวเอง
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findAll(query, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string, role?: string }) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.findOne(id, tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: any,
    @CurrentUser() user: { tenantId?: string, role?: string },
  ) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.update(id, updateUserDto, tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string, role?: string }) {
    const tenantId = user.role === 'platform_admin' ? undefined : user?.tenantId;
    return this.usersService.remove(id, tenantId);
  }
}
