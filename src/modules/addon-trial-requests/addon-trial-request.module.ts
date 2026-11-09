import { Module } from '@nestjs/common';
import {
  AddonTrialRequestController,
  AdminAddonTrialRequestController,
} from './addon-trial-request.controller';
import { AddonTrialRequestService } from './addon-trial-request.service';
import { AddonTrialExpiryService } from './addon-trial-expiry.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [AddonTrialRequestController, AdminAddonTrialRequestController],
  providers: [AddonTrialRequestService, AddonTrialExpiryService],
  exports: [AddonTrialRequestService],
})
export class AddonTrialRequestModule {}
