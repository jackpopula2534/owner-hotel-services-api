import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
