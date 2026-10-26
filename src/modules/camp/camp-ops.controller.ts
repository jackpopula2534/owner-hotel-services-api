import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AddonGuard } from '../../common/guards/addon.guard';
import { RequireAddon } from '../../common/decorators/require-addon.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CAMP_OPS_WRITE_ROLES, CAMP_READ_ROLES } from './camp-roles';
import { CampOpsService } from './camp-ops.service';
import {
  CreateOpsTaskDto,
  OpsBoardQueryDto,
  SetFacilityStatusDto,
  SetPitchStatusDto,
  UpdateOpsTaskDto,
} from './dto/camp-ops.dto';

interface OpsUser {
  id?: string;
  tenantId?: string;
}

function requireTenant(user: OpsUser): string {
  if (!user?.tenantId) throw new BadRequestException('ต้องเข้าสู่ระบบด้วยบัญชีของกิจการ');
  return user.tenantId;
}

/**
 * /api/v1/camp/ops — งานหน้าลานจากหน้า Monitor 3D
 * พนักงานลาน (camp_staff) ทำได้ทุกอย่างที่นี่ — สถานะจุดแบบหน้างาน ไม่ใช่การแก้ข้อมูลหลักของจุด
 */
@ApiTags('camp-ops')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'camp/ops', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('CAMP_MODULE')
export class CampOpsController {
  constructor(private readonly service: CampOpsService) {}

  @Get('board')
  @ApiOperation({ summary: 'Today board: active stays with balances, open tasks, recent activity' })
  @Roles(...CAMP_READ_ROLES)
  board(@Query() q: OpsBoardQueryDto, @CurrentUser() user: OpsUser) {
    return this.service.board(q.campgroundId, requireTenant(user));
  }

  @Patch('pitches/:id/status')
  @ApiOperation({ summary: 'Set pitch operational status (cleaning done / block / unblock)' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  setPitchStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPitchStatusDto, @CurrentUser() user: OpsUser) {
    return this.service.setPitchStatus(id, dto, requireTenant(user), user.id);
  }

  @Patch('facilities/:id/status')
  @ApiOperation({ summary: 'Set facility status (open / closed / maintenance)' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  setFacilityStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFacilityStatusDto,
    @CurrentUser() user: OpsUser,
  ) {
    return this.service.setFacilityStatus(id, dto, requireTenant(user), user.id);
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Open a cleaning or maintenance task' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  createTask(@Body() dto: CreateOpsTaskDto, @CurrentUser() user: OpsUser) {
    return this.service.createTask(dto, requireTenant(user), user.id);
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Assign / update / close a task (closing restores pitch/facility status)' })
  @Roles(...CAMP_OPS_WRITE_ROLES)
  updateTask(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOpsTaskDto, @CurrentUser() user: OpsUser) {
    return this.service.updateTask(id, dto, requireTenant(user), user.id);
  }
}
