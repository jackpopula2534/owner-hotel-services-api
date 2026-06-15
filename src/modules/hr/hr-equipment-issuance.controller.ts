import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { HrEquipmentIssuanceService } from './hr-equipment-issuance.service';
import { IssueEquipmentDto, AcknowledgeIssuanceDto, EditIssuanceDto } from './dto/hr-equipment-issuance.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

type AuthUser = { tenantId?: string; id?: string };

@ApiTags('hr / equipment issuance')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/equipment-issuances', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrEquipmentIssuanceController {
  constructor(private readonly service: HrEquipmentIssuanceService) {}

  @Get()
  @ApiOperation({ summary: 'List equipment issuances' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async list(@Query() query: Record<string, string>, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an equipment issuance checklist' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'HR issues equipment items (with serial numbers)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async issue(@Param('id') id: string, @Body() dto: IssueEquipmentDto, @CurrentUser() user: AuthUser) {
    return this.service.issue(id, dto, user.tenantId!, user.id!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an issued record (adjust serial numbers / note, no re-deduction)' })
  @ApiParam({ name: 'id' })
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async edit(@Param('id') id: string, @Body() dto: EditIssuanceDto, @CurrentUser() user: AuthUser) {
    return this.service.editIssuance(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/acknowledge')
  @ApiOperation({ summary: 'Employee acknowledges receipt of issued equipment' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'hr', 'staff')
  async acknowledge(@Param('id') id: string, @Body() dto: AcknowledgeIssuanceDto, @CurrentUser() user: AuthUser) {
    return this.service.acknowledge(id, dto, user.tenantId!, user.id!);
  }

  @Post(':id/return')
  @ApiOperation({ summary: 'Mark all equipment as returned (offboarding / failed probation)' })
  @ApiParam({ name: 'id' })
  @HttpCode(HttpStatus.OK)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async markReturned(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markReturned(id, user.tenantId!, user.id!);
  }
}
