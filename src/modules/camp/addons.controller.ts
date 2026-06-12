import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddonsService } from './addons.service';
import { CreateAddonDto, UpdateAddonDto } from './dto/addon.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];
const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin'];

@ApiTags('camp-addons')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/addons', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AddonsController {
  constructor(private readonly service: AddonsService) {}

  @Get()
  @ApiOperation({ summary: 'List rental addons by campgroundId' })
  @Roles(...READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll(campgroundId, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get addon by id' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create rental addon' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateAddonDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update rental addon' })
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAddonDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete rental addon' })
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user?.tenantId);
  }
}
