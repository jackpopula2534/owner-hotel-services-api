import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';
import { GoodsReceivesService } from './goods-receives.service';
import { GoodsReceivesController } from './goods-receives.controller';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [GoodsReceivesController],
  providers: [GoodsReceivesService],
  exports: [GoodsReceivesService],
})
export class GoodsReceivesModule {}
