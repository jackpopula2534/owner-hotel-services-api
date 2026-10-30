import { Module } from '@nestjs/common';
import { ArReceiptsController } from './ar-receipts.controller';
import { ArReceiptsService } from './ar-receipts.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [ArReceiptsController],
  providers: [ArReceiptsService],
  exports: [ArReceiptsService],
})
export class ArReceiptsModule {}
