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
    @CurrentUser() user: any,
    @Body() createAnalyticsEventDto: CreateAnalyticsEventDto,
  ) {
    return this.analyticsService.trackEvent(
      user.id,
      user.tenantId,
      createAnalyticsEventDto,
    );
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: any) {
    return this.analyticsService.getSummary(user.tenantId);
  }

  @Get('feature-flag/:name')
  async getFeatureFlag(@Param('name') name: string, @CurrentUser() user: any) {
    return this.analyticsService.getFeatureFlag(name, user.tenantId);
  }
}
