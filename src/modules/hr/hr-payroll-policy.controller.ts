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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { HrPayrollPolicyService } from './hr-payroll-policy.service';
import {
  CreateHrPayrollPolicyDto,
  UpdateHrPayrollPolicyDto,
} from './dto/create-hr-payroll-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { HrAddonGuard } from '../../common/guards/hr-addon.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('hr / payroll policy')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'hr/payroll-policies', version: '1' })
@UseGuards(JwtAuthGuard, HrAddonGuard, RolesGuard)
export class HrPayrollPolicyController {
  constructor(private readonly service: HrPayrollPolicyService) {}

  @Get('effective')
  @ApiOperation({ summary: 'Resolve the effective payroll policy (tenant/property)' })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async effective(
    @Query('propertyId') propertyId: string | undefined,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.resolveEffective(user.tenantId!, propertyId);
  }

  @Get()
  @ApiOperation({ summary: 'List payroll policies' })
  @ApiQuery({ name: 'propertyId', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.service.findAll(query, user.tenantId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payroll policy by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.findOne(id, user.tenantId!);
  }

  @Post()
  @ApiOperation({ summary: 'Create a payroll policy' })
  @HttpCode(HttpStatus.CREATED)
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async create(
    @Body() dto: CreateHrPayrollPolicyDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.create(dto, user.tenantId!, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a payroll policy' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHrPayrollPolicyDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.service.update(id, dto, user.tenantId!, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a payroll policy' })
  @ApiParam({ name: 'id' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'hr')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.service.remove(id, user.tenantId!);
  }
}
