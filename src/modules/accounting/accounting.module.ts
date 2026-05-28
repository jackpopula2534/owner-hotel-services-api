import { Module } from '@nestjs/common';
import { ChartOfAccountsModule } from './chart-of-accounts/chart-of-accounts.module';
import { FiscalYearsModule } from './fiscal-years/fiscal-years.module';
import { JournalEntriesModule } from './journal-entries/journal-entries.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    ChartOfAccountsModule,
    FiscalYearsModule,
    JournalEntriesModule,
    LedgerModule,
  ],
  exports: [
    ChartOfAccountsModule,
    FiscalYearsModule,
    JournalEntriesModule,
    LedgerModule,
  ],
})
export class AccountingModule {}
