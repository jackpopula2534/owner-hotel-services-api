import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LeadService } from './lead.service';
import { CreateLeadDto, QualifyLeadDto, QueryLeadsDto, UpdateLeadDto } from './dto/lead.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/leads')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/leads' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadController {
  constructor(private readonly leads: LeadService) {}

  @Get()
  @ApiOperation({ summary: 'List leads with filtering' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async findAll(@Query() query: QueryLeadsDto, @CurrentUser() user: { tenantId?: string }) {
    return this.leads.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get lead by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.leads.findOne(id, user?.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new lead' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async create(@Body() dto: CreateLeadDto, @CurrentUser() user: { tenantId?: string }) {
    return this.leads.create(dto, user?.tenantId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a lead' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leads.update(id, dto, user?.tenantId);
  }

  @Patch(':id/assign/:userId')
  @ApiOperation({ summary: 'Assign a lead to a sales rep' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async assign(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leads.assign(id, userId, user?.tenantId);
  }

  @Post(':id/qualify')
  @ApiOperation({ summary: 'Qualify lead → create CrmDeal' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async qualify(
    @Param('id') id: string,
    @Body() dto: QualifyLeadDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.leads.qualify(id, dto, user?.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a lead (not allowed if converted)' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.leads.remove(id, user?.tenantId);
  }
}
