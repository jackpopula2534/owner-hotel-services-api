import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { StockCountsService } from './stock-counts.service';
import { StockCountsController } from './stock-counts.controller';

@Module({
  imports: [AddonModule],
  controllers: [StockCountsController],
  providers: [StockCountsService],
  exports: [StockCountsService],
})
export class StockCountsModule {}
