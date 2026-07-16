import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FacilitiesService } from './facilities.service';
import {
  CreateFacilityDto,
  UpdateFacilityDto,
  UpdateFacilityPositionDto,
} from './dto/facility.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin', 'staff', 'user'];
const WRITE_ROLES: UserRole[] = ['admin', 'manager', 'tenant_admin', 'platform_admin'];

@ApiTags('camp-facilities')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/facilities', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class FacilitiesController {
  constructor(private readonly service: FacilitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List facilities by campgroundId' })
  @Roles(...READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll(campgroundId, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get facility by id' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create facility' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateFacilityDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user?.tenantId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update facility' })
  @Roles(...WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFacilityDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user?.tenantId);
  }

  @Patch(':id/position')
  @ApiOperation({ summary: 'Update facility position on 2D map (owner drag & drop)' })
  @Roles(...WRITE_ROLES)
  updatePosition(
    @Param('id') id: string,
    @Body() dto: UpdateFacilityPositionDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.updatePosition(id, dto.posX, dto.posY, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete facility' })
  @Roles(...WRITE_ROLES)
  remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user?.tenantId);
  }
}
