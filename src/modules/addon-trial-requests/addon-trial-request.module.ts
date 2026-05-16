import { Module } from '@nestjs/common';
import {
  AddonTrialRequestController,
  AdminAddonTrialRequestController,
} from './addon-trial-request.controller';
import { AddonTrialRequestService } from './addon-trial-request.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [AddonTrialRequestController, AdminAddonTrialRequestController],
  providers: [AddonTrialRequestService],
  exports: [AddonTrialRequestService],
})
export class AddonTrialRequestModule {}
