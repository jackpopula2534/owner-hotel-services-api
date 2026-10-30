import { Module } from '@nestjs/common';
import { GuestFolioController } from './guest-folio.controller';
import { GuestFolioService } from './guest-folio.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { JournalEntriesModule } from '@/modules/accounting/journal-entries/journal-entries.module';
import { CashDrawersModule } from '@/modules/cash-management/cash-drawers/cash-drawers.module';

@Module({
  imports: [AddonModule, JournalEntriesModule, CashDrawersModule],
  controllers: [GuestFolioController],
  providers: [GuestFolioService],
  exports: [GuestFolioService],
})
export class GuestFolioModule {}
