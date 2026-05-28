import { Module } from '@nestjs/common';
import { ApInvoicesModule } from './ap-invoices/ap-invoices.module';
import { ApPaymentsModule } from './ap-payments/ap-payments.module';

@Module({
  imports: [ApInvoicesModule, ApPaymentsModule],
  exports: [ApInvoicesModule, ApPaymentsModule],
})
export class AccountsPayableModule {}
