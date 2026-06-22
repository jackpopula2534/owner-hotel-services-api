import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequisitionsService } from './requisitions.service';
import { CreateCampRequisitionDto } from './dto/requisition.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import type { UserRole } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const READ_ROLES: UserRole[] = [
  'admin',
  'manager',
  'tenant_admin',
  'platform_admin',
  'staff',
  'user',
];
const WRITE_ROLES: UserRole[] = [
  'admin',
  'manager',
  'tenant_admin',
  'platform_admin',
  'staff',
];

interface AuthUser {
  id?: string;
  tenantId?: string;
}

@ApiTags('camp-requisitions')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/requisitions', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class RequisitionsController {
  constructor(private readonly service: RequisitionsService) {}

  @Get()
  @ApiOperation({ summary: 'List camp requisitions (ใบเบิก/ใบโอน)' })
  @Roles(...READ_ROLES)
  findAll(
    @Query('campgroundId') campgroundId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(campgroundId, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get camp requisition by id' })
  @Roles(...READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create camp requisition (draft)' })
  @ApiResponse({ status: 201, description: 'Created (draft)' })
  @Roles(...WRITE_ROLES)
  create(@Body() dto: CreateCampRequisitionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user?.tenantId, user?.id);
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Confirm requisition — perform stock movement + replenish addons',
  })
  @Roles(...WRITE_ROLES)
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user?.tenantId, user?.id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a draft requisition' })
  @Roles(...WRITE_ROLES)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user?.tenantId, user?.id);
  }
}
