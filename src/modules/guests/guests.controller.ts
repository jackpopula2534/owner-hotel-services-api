import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GuestsService } from './guests.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('guests')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'guests' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all guests' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findAll(@Query() query: any, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get guest by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new guest' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async create(
    @Body() createGuestDto: any,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    return this.guestsService.create(createGuestDto, user?.tenantId, user?.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update guest (PUT)' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async updatePut(
    @Param('id') id: string,
    @Body() updateGuestDto: any,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    console.log(`Update (PUT) called for ID: ${id}, tenantId: ${user?.tenantId}`);
    return this.guestsService.update(id, updateGuestDto, user?.tenantId, user?.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update guest (PATCH)' })
  @Roles('admin', 'manager', 'tenant_admin', 'receptionist', 'platform_admin', 'staff', 'user')
  async updatePatch(
    @Param('id') id: string,
    @Body() updateGuestDto: any,
    @CurrentUser() user: { id?: string; tenantId?: string },
  ) {
    console.log(`Update (PATCH) called for ID: ${id}, tenantId: ${user?.tenantId}`);
    return this.guestsService.update(id, updateGuestDto, user?.tenantId, user?.id);
  }

  @Patch('*')
  async debugPatch(@Param() params: any, @Body() body: any) {
    console.log('DEBUG: Wildcard PATCH caught', params, body);
    return { success: true, debug: 'Wildcard caught' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete guest' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.guestsService.remove(id, user?.tenantId);
  }
}
