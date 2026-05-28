import { Module } from '@nestjs/common';
import { DepreciationController } from './depreciation.controller';
import { DepreciationService } from './depreciation.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
