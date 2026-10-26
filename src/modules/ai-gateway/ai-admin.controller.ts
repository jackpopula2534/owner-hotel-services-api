import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { SkipTenantScope } from '../../common/tenant/skip-tenant-scope.decorator';
import { AI_PROVIDERS } from './ai-gateway.constants';
import { AiAdminService, AiProviderTestResult, AiProviderView, AiSettingsView } from './ai-admin.service';
import {
  AiUsageLogsQueryDto,
  AiUsageSummaryQueryDto,
  UpdateAiProviderDto,
  UpdateAiSettingsDto,
} from './dto/ai-admin.dto';

type AdminUser = { userId?: string };

/**
 * /api/v1/admin/ai — คีย์ AI ของแพลตฟอร์ม + งบ + รายงานต้นทุน
 * เฉพาะ platform admin (isPlatformAdmin claim) — คีย์จริงไม่เคยถูกส่งกลับ
 */
@ApiTags('Admin - AI Providers')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'admin/ai', version: '1' })
@SkipSubscriptionCheck()
@SkipTenantScope()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AiAdminController {
  constructor(private readonly service: AiAdminService) {}

  @Get('providers')
  @ApiOperation({ summary: 'List AI providers (keys masked)' })
  @ApiResponse({ status: 200, description: 'Providers with masked keys, models and pricing' })
  listProviders(): Promise<AiProviderView[]> {
    return this.service.listProviders();
  }

  @Put('providers/:provider')
  @ApiOperation({ summary: 'Update provider key / enabled / models + pricing' })
  @ApiParam({ name: 'provider', enum: AI_PROVIDERS })
  @ApiResponse({ status: 200, description: 'Updated provider (masked)' })
  @ApiResponse({ status: 400, description: 'Invalid key / pricing, or enabling without key' })
  updateProvider(
    @Param('provider') provider: string,
    @Body() dto: UpdateAiProviderDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AiProviderView> {
    return this.service.updateProvider(this.service.assertProvider(provider), dto, user?.userId);
  }

  @Delete('providers/:provider/key')
  @ApiOperation({ summary: 'Remove provider key (also disables provider)' })
  @ApiParam({ name: 'provider', enum: AI_PROVIDERS })
  @ApiResponse({ status: 200, description: 'Provider without key' })
  removeKey(@Param('provider') provider: string, @CurrentUser() user: AdminUser): Promise<AiProviderView> {
    return this.service.removeKey(this.service.assertProvider(provider), user?.userId);
  }

  @Post('providers/:provider/test')
  @ApiOperation({ summary: 'Test provider connection with the saved key (free call)' })
  @ApiParam({ name: 'provider', enum: AI_PROVIDERS })
  @ApiResponse({ status: 201, description: 'Test result' })
  testProvider(@Param('provider') provider: string, @CurrentUser() user: AdminUser): Promise<AiProviderTestResult> {
    return this.service.testProvider(this.service.assertProvider(provider), user?.userId);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Platform AI budget settings' })
  @ApiResponse({ status: 200, description: 'Settings' })
  getSettings(): Promise<AiSettingsView> {
    return this.service.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update platform AI budget settings' })
  @ApiResponse({ status: 200, description: 'Updated settings' })
  updateSettings(@Body() dto: UpdateAiSettingsDto, @CurrentUser() user: AdminUser): Promise<AiSettingsView> {
    return this.service.updateSettings(dto, user?.userId);
  }

  @Get('usage/summary')
  @ApiOperation({ summary: 'AI cost summary for a month (Thai time)' })
  @ApiResponse({ status: 200, description: 'Totals, budget, breakdown by provider/feature/tenant/day' })
  getSummary(@Query() query: AiUsageSummaryQueryDto) {
    return this.service.getSummary(query.period);
  }

  @Get('usage/logs')
  @ApiOperation({ summary: 'AI usage logs (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated ai_usage_logs' })
  listLogs(@Query() query: AiUsageLogsQueryDto) {
    return this.service.listLogs(query);
  }
}
