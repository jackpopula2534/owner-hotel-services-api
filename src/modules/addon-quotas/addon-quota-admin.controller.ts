import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { SkipTenantScope } from '../../common/tenant/skip-tenant-scope.decorator';
import { QUOTA_ADDONS } from './addon-quota.constants';
import {
  AddonQuotaAdminService,
  AddonQuotaConfigView,
  AddonQuotaSummary,
} from './addon-quota-admin.service';
import { AddonQuotaSummaryQueryDto, UpdateAddonQuotaDto } from './dto/addon-quota.dto';

type AdminUser = { userId?: string };

/** /api/v1/admin/addon-quotas — ราคา + โควตา + รายรับของ add-on ที่คิดตามจำนวนครั้ง (platform admin) */
@ApiTags('Admin - Add-on Quotas')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/addon-quotas', version: '1' })
@SkipSubscriptionCheck()
@SkipTenantScope()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AddonQuotaAdminController {
  constructor(private readonly service: AddonQuotaAdminService) {}

  @Get(':addonCode')
  @ApiOperation({ summary: 'Get add-on price + quota config' })
  @ApiParam({ name: 'addonCode', enum: QUOTA_ADDONS })
  @ApiResponse({ status: 200, description: 'Quota config with monthly price' })
  @ApiResponse({ status: 404, description: 'Add-on has no usage quota' })
  getConfig(@Param('addonCode') addonCode: string): Promise<AddonQuotaConfigView> {
    return this.service.getConfig(this.service.assertQuotaAddon(addonCode));
  }

  @Put(':addonCode')
  @ApiOperation({ summary: 'Update add-on price + quota config' })
  @ApiParam({ name: 'addonCode', enum: QUOTA_ADDONS })
  @ApiResponse({ status: 200, description: 'Updated config' })
  @ApiResponse({
    status: 400,
    description: 'Invalid values (e.g. no included quota and no overage price)',
  })
  updateConfig(
    @Param('addonCode') addonCode: string,
    @Body() dto: UpdateAddonQuotaDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AddonQuotaConfigView> {
    return this.service.updateConfig(this.service.assertQuotaAddon(addonCode), dto, user?.userId);
  }

  @Get(':addonCode/summary')
  @ApiOperation({ summary: 'Add-on subscribers, revenue and quota usage for a month' })
  @ApiParam({ name: 'addonCode', enum: QUOTA_ADDONS })
  @ApiResponse({ status: 200, description: 'Revenue + usage summary' })
  getSummary(
    @Param('addonCode') addonCode: string,
    @Query() query: AddonQuotaSummaryQueryDto,
  ): Promise<AddonQuotaSummary> {
    return this.service.getSummary(this.service.assertQuotaAddon(addonCode), query.period);
  }
}
