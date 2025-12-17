import {
  Controller,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { SubscriptionManagementService } from './subscription-management.service';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { AddFeatureDto } from './dto/add-feature.dto';
import { DowngradePlanDto } from './dto/downgrade-plan.dto';

@Controller('subscription-management')
export class SubscriptionManagementController {
  constructor(
    private readonly subscriptionManagementService: SubscriptionManagementService,
  ) {}

  /**
   * 8️⃣ Upgrade Plan
   * POST /subscription-management/upgrade
   */
  @Post('upgrade')
  async upgradePlan(@Body() upgradePlanDto: UpgradePlanDto) {
    return this.subscriptionManagementService.upgradePlan(
      upgradePlanDto.subscriptionId,
      upgradePlanDto.newPlanId,
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

