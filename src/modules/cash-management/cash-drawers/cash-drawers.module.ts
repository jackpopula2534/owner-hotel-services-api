import { Module } from '@nestjs/common';
import { CashDrawersController } from './cash-drawers.controller';
import { CashDrawersService } from './cash-drawers.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { JournalEntriesModule } from '@/modules/accounting/journal-entries/journal-entries.module';

@Module({
  imports: [AddonModule, JournalEntriesModule],
  controllers: [CashDrawersController],
  providers: [CashDrawersService],
  exports: [CashDrawersService],
})
export class CashDrawersModule {}
