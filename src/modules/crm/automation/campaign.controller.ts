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
import { CampaignService } from './campaign.service';
import { CreateCampaignDto, QueryCampaignsDto, UpdateCampaignDto } from './dto/campaign.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/campaigns')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/campaigns' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async findAll(@Query() query: QueryCampaignsDto, @CurrentUser() user: { tenantId?: string }) {
    return this.campaigns.findAll(query, user?.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign by ID' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async findOne(@Param('id') id: string, @CurrentUser() user: { tenantId?: string }) {
    return this.campaigns.findOne(id, user?.tenantId);
  }

  @Get(':id/audience-preview')
  @ApiOperation({ summary: 'Preview audience size without sending' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async preview(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.campaigns.previewAudience(id, user.tenantId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get delivery stats for a campaign' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async stats(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.campaigns.getStats(id, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft campaign' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async create(
    @Body() dto: CreateCampaignDto,
    @CurrentUser() user: { tenantId?: string; id?: string },
  ) {
    return this.campaigns.create(dto, user?.tenantId, user?.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft / scheduled campaign' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: { tenantId?: string },
  ) {
    return this.campaigns.update(id, dto, user?.tenantId);
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule campaign for dispatch (delay = scheduledAt - now)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async schedule(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.campaigns.schedule(id, user.tenantId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a scheduled campaign' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async cancel(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.campaigns.cancel(id, user.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a campaign (must not be running)' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async remove(@Param('id') id: string, @CurrentUser() user: { tenantId: string }) {
    return this.campaigns.remove(id, user.tenantId);
  }
}
