import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { HrLeavePolicyService } from './hr-leave-policy.service';
import { CreateHrLeavePolicyDto, UpdateHrLeavePolicyDto } from './dto/hr-leave-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / leave policy')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/leave-policies', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrLeavePolicyController {
  constructor(private readonly service: HrLeavePolicyService) {}

  @Get()
  @ApiOperation({ summary: 'List leave policies' })
  @ApiQuery({ name: 'leaveTypeId', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findAll(@Query() query: Record<string, string>, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a leave policy by ID' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Create a leave policy' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(@Body() dto: CreateHrLeavePolicyDto, @CurrentUser() user: { tenantId?: string }) {
    return this.service.create(dto, user.tenantId!);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a leave policy' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrLeavePolicyDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.update(id, dto, user.tenantId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a leave policy' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user.tenantId!);
  }
}
