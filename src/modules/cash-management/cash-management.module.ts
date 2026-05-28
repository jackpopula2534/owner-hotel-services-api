import { Module } from '@nestjs/common';
import { CashDrawersModule } from './cash-drawers/cash-drawers.module';
import { BankReconciliationModule } from './bank-reconciliation/bank-reconciliation.module';

@Module({
  imports: [CashDrawersModule, BankReconciliationModule],
  exports: [CashDrawersModule, BankReconciliationModule],
})
export class CashManagementModule {}
