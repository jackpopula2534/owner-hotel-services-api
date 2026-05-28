import { Module } from '@nestjs/common';
import { ArReceiptsController } from './ar-receipts.controller';
import { ArReceiptsService } from './ar-receipts.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [ArReceiptsController],
  providers: [ArReceiptsService],
  exports: [ArReceiptsService],
})
export class ArReceiptsModule {}
