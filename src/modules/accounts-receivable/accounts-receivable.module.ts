import { Module } from '@nestjs/common';
import { GuestFolioModule } from './guest-folio/guest-folio.module';
import { ArInvoicesModule } from './ar-invoices/ar-invoices.module';
import { ArReceiptsModule } from './ar-receipts/ar-receipts.module';

@Module({
  imports: [GuestFolioModule, ArInvoicesModule, ArReceiptsModule],
  exports: [GuestFolioModule, ArInvoicesModule, ArReceiptsModule],
})
export class AccountsReceivableModule {}
