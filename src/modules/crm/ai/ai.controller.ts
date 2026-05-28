import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SentimentService } from './sentiment.service';
import { ChurnPredictionService } from './churn-prediction.service';
import { SmartSegmentationService } from './smart-segmentation.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('crm/ai')
@ApiBearerAuth('JWT-auth')
@Controller({ path: 'crm/ai' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly sentiment: SentimentService,
    private readonly churn: ChurnPredictionService,
    private readonly segmentation: SmartSegmentationService,
  ) {}

  @Get('sentiment/trend')
  @ApiOperation({ summary: 'Sentiment trend over the last N days (default 30)' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async sentimentTrend(
    @Query('days') days: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.sentiment.getTrend(user.tenantId, days ? parseInt(days, 10) : 30);
  }

  @Get('churn/high-risk')
  @ApiOperation({ summary: 'List contacts currently at high or critical churn risk' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async highRisk(
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.churn.listHighRisk(user.tenantId, limit ? parseInt(limit, 10) : 50);
  }

  @Get('churn/guest/:guestId')
  @ApiOperation({ summary: 'Latest churn score for a guest' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager', 'crm_agent')
  async guestChurn(@Param('guestId') guestId: string, @CurrentUser() user: { tenantId: string }) {
    return this.churn.getLatest(user.tenantId, guestId);
  }

  @Post('churn/recompute')
  @ApiOperation({ summary: 'Trigger churn recomputation for current tenant (admin)' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async recomputeChurn(@CurrentUser() user: { tenantId: string }) {
    const scored = await this.churn.recomputeForTenant(user.tenantId);
    return { scored };
  }

  @Get('segments/distribution')
  @ApiOperation({ summary: 'Segment distribution for current tenant' })
  @Roles('admin', 'manager', 'tenant_admin', 'platform_admin', 'crm_manager')
  async segmentDistribution(@CurrentUser() user: { tenantId: string }) {
    return this.segmentation.distribution(user.tenantId);
  }

  @Post('segments/recompute')
  @ApiOperation({ summary: 'Trigger smart segmentation recomputation (admin)' })
  @Roles('admin', 'tenant_admin', 'platform_admin')
  async recomputeSegments(@CurrentUser() user: { tenantId: string }) {
    const updated = await this.segmentation.recomputeForTenant(user.tenantId);
    return { updated };
  }
}
