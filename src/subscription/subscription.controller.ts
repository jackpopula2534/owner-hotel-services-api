import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SelfServicePlanService } from './self-service-plan.service';

@Controller('subscription')
@SkipSubscriptionCheck()
export class SubscriptionController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly selfServicePlan: SelfServicePlanService,
  ) {}

  @Get('renewal-status')
  @UseGuards(JwtAuthGuard)
  async getRenewalStatus(@CurrentUser() user: any) {
    const subscription = await this.subscriptionsService.findByTenantId(user.tenant_id);

    return {
      status: subscription?.status || 'inactive',
      endDate: subscription?.end_date || null,
      autoRenew: (subscription as any)?.auto_renew || false,
      paymentHistory: [],
    };
  }

  @Get('change-plan/preview')
  @UseGuards(JwtAuthGuard)
  async previewChangePlan(
    @CurrentUser() user: any,
    @Query('newPlanId') newPlanId: string,
    @Query('effectiveDate') effectiveDate?: string,
  ) {
    return this.selfServicePlan.preview({
      tenantId: user.tenant_id,
      newPlanId,
      effectiveDate,
    });
  }

  @Post('change-plan')
  @UseGuards(JwtAuthGuard)
  async confirmChangePlan(
    @CurrentUser() user: any,
    @Body('newPlanId') newPlanId: string,
    @Body('effectiveDate') effectiveDate?: string,
    @Body('reason') reason?: string,
  ) {
    return this.selfServicePlan.confirm({
      tenantId: user.tenant_id,
      newPlanId,
      effectiveDate,
      reason,
      actorId: user.id || user.user_id,
    });
  }
}
