import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { GoodsReceivesService } from './goods-receives.service';
import { GoodsReceivesController } from './goods-receives.controller';

@Module({
  imports: [AddonModule],
  controllers: [GoodsReceivesController],
  providers: [GoodsReceivesService],
  exports: [GoodsReceivesService],
})
export class GoodsReceivesModule {}
