import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { SubscriptionManagementService } from './subscription-management.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { SubscriptionActor } from './subscription-actor';

/**
 * Plan upgrade, called by the tenant that owns the subscription (the checkout
 * page upgrades a trial to the plan the user picked).
 *
 * `@Roles('tenant_admin')` is a floor, not an exact match — RolesGuard admits
 * any role at level >= 85, which is how platform_admin also reaches this route.
 * A platform admin may legitimately act on any subscription, so the role alone
 * cannot prove ownership: the service compares `subscription.tenant_id` against
 * the caller's tenant. See `assertCanManage()`.
 */
@Controller('subscription-management')
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('tenant_admin')
export class SubscriptionManagementController {
  constructor(private readonly subscriptionManagementService: SubscriptionManagementService) {}

  /**
   * Upgrade Plan
   * POST /subscription-management/upgrade
   */
  @Post('upgrade')
  async upgradePlan(
    @CurrentUser() actor: SubscriptionActor,
    @Body() upgradePlanDto: UpgradePlanDto,
  ) {
    return this.subscriptionManagementService.upgradePlan(
      actor,
      upgradePlanDto.subscriptionId,
      upgradePlanDto.newPlanId,
      { createInvoice: upgradePlanDto.createInvoice },
    );
  }
}
