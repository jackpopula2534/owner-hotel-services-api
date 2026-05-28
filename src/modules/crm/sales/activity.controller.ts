import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { CompleteActivityDto, CreateActivityDto } from './dto/activity.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/activities')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/activities' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityController {
  constructor(private readonly activities: ActivityService) {}

  @Post()
  @ApiOperation({ summary: 'Create a sales activity (note/call/email/meeting/task)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async create(
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.activities.create(dto, user?.tenantId, user?.id);
  }

  @Get('leads/:leadId')
  @ApiOperation({ summary: 'List activities for a lead' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async listForLead(@Param('leadId') leadId: string, @CurrentUser() user: { tenantId: string }) {
    return this.activities.listForLead(leadId, user.tenantId);
  }

  @Get('deals/:dealId')
  @ApiOperation({ summary: 'List activities for a deal' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async listForDeal(@Param('dealId') dealId: string, @CurrentUser() user: { tenantId: string }) {
    return this.activities.listForDeal(dealId, user.tenantId);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark a task activity as completed' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'sales_rep')
  async complete(
    @Param('id') id: string,
    @Body() dto: CompleteActivityDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.activities.completeTask(id, dto, user.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an activity' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.activities.remove(id, user.tenantId);
  }
}
