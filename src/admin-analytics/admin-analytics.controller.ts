import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SaasAnalyticsService } from './saas-analytics.service';

@ApiTags('Admin / SaaS Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminAnalyticsController {
  constructor(private readonly analytics: SaasAnalyticsService) {}

  @Get('mrr')
  @ApiOperation({ summary: 'Current MRR + ARR breakdown by plan' })
  async mrr(@Query('asOf') asOf?: string) {
    return this.analytics.getMrrSummary(asOf ? new Date(asOf) : undefined);
  }

  @Get('mrr/trend')
  @ApiOperation({ summary: '12-month rolling MRR trend' })
  async mrrTrend(@Query('asOf') asOf?: string) {
    return this.analytics.getMrrTrend(asOf ? new Date(asOf) : undefined);
  }

  @Get('churn')
  @ApiOperation({ summary: 'Logo + revenue churn for a period' })
  async churn(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const periodEnd = to ? new Date(to) : new Date();
    const periodStart = from ? new Date(from) : new Date(periodEnd);
    if (!from) periodStart.setMonth(periodStart.getMonth() - 1);
    return this.analytics.getChurnSummary(periodStart, periodEnd);
  }

  @Get('ltv')
  @ApiOperation({ summary: 'Average MRR + estimated LTV' })
  async ltv() {
    return this.analytics.getLtvSummary();
  }
}
