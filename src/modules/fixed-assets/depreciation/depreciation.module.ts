import { Module } from '@nestjs/common';
import { DepreciationController } from './depreciation.controller';
import { DepreciationService } from './depreciation.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
