import { Controller, Post, Body, Get, Param, UseGuards, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsEventDto } from './dto/analytics.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller({ path: 'analytics', version: '1' })
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('event')
  async trackEvent(
    @CurrentUser() user: { userId: string; tenantId: string },
    @Body() createAnalyticsEventDto: CreateAnalyticsEventDto,
  ) {
    return this.analyticsService.trackEvent(
      user.userId,
      user.tenantId,
      createAnalyticsEventDto,
    );
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: { tenantId: string }) {
    return this.analyticsService.getSummary(user.tenantId);
  }

  @Get('feature-flag/:name')
  async getFeatureFlag(@Param('name') name: string, @CurrentUser() user: { tenantId: string }) {
    return this.analyticsService.getFeatureFlag(name, user.tenantId);
  }
}
