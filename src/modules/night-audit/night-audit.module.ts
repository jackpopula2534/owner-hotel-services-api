import { Module } from '@nestjs/common';
import { NightAuditController } from './night-audit.controller';
import { NightAuditService } from './night-audit.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { JournalEntriesModule } from '@/modules/accounting/journal-entries/journal-entries.module';
import { FolioPostingModule } from '@/modules/accounts-receivable/folio-posting/folio-posting.module';

@Module({
  imports: [AddonModule, JournalEntriesModule, FolioPostingModule],
  controllers: [NightAuditController],
  providers: [NightAuditService],
  exports: [NightAuditService],
})
export class NightAuditModule {}
