import { AllowSystems } from '../../common/decorators/allow-systems.decorator';
import { Controller, Get, Put, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PositionKitService } from './position-kit.service';
import { UpdatePositionKitDto } from './dto/recruitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

@ApiTags('hr / recruitment — position equipment kits')
@ApiBearerAuth('JWT-auth')
// HR Terminal — H1 allow-list, audit 2026-11-09
@AllowSystems('hr')
@Controller({ path: 'hr/recruitment/position-kits', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class PositionKitController {
  constructor(private readonly service: PositionKitService) {}

  @Get(':positionId')
  @ApiOperation({ summary: 'Get the standard equipment kit of a position' })
  @ApiParam({ name: 'positionId' })
  @ApiResponse({ status: 200, description: '{ positionId, items: [{ itemId?, name, qty, note? }] }' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async get(@Param('positionId') positionId: string, @CurrentUser() user: AuthUser) {
    return this.service.get(positionId, user.tenantId!);
  }

  @Put(':positionId')
  @ApiOperation({ summary: 'Replace the standard equipment kit of a position' })
  @ApiParam({ name: 'positionId' })
  @ApiResponse({ status: 200, description: '{ positionId, items }' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(@Param('positionId') positionId: string, @Body() dto: UpdatePositionKitDto, @CurrentUser() user: AuthUser) {
    return this.service.update(positionId, dto, user.tenantId!, user.id!);
  }
}
