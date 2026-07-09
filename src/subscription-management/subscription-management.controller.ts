import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { SubscriptionManagementService } from './subscription-management.service';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { AddFeatureDto } from './dto/add-feature.dto';
import { DowngradePlanDto } from './dto/downgrade-plan.dto';

@Controller('subscription-management')
@SkipSubscriptionCheck()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('platform_admin')
export class SubscriptionManagementController {
  constructor(private readonly subscriptionManagementService: SubscriptionManagementService) {}

  /**
   * 8️⃣ Upgrade Plan
   * POST /subscription-management/upgrade
   */
  @Post('upgrade')
  async upgradePlan(@Body() upgradePlanDto: UpgradePlanDto) {
    return this.subscriptionManagementService.upgradePlan(
      upgradePlanDto.subscriptionId,
      upgradePlanDto.newPlanId,
      { createInvoice: upgradePlanDto.createInvoice },
    );
  }

  /**
   * Add Feature
   * POST /subscription-management/add-feature
   */
  @Post('add-feature')
  async addFeature(@Body() addFeatureDto: AddFeatureDto) {
    return this.subscriptionManagementService.addFeature(
      addFeatureDto.subscriptionId,
      addFeatureDto.featureId,
    );
  }

  /**
   * Downgrade Plan
   * POST /subscription-management/downgrade
   */
  @Post('downgrade')
  async downgradePlan(@Body() downgradePlanDto: DowngradePlanDto) {
    return this.subscriptionManagementService.scheduleDowngrade(
      downgradePlanDto.subscriptionId,
      downgradePlanDto.newPlanId,
    );
  }
}
