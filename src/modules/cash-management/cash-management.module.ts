import { Module } from '@nestjs/common';
import { CashDrawersModule } from './cash-drawers/cash-drawers.module';
import { BankReconciliationModule } from './bank-reconciliation/bank-reconciliation.module';
import { BankStatementsModule } from './bank-statements/bank-statements.module';

@Module({
  imports: [CashDrawersModule, BankReconciliationModule, BankStatementsModule],
  exports: [CashDrawersModule, BankReconciliationModule, BankStatementsModule],
})
export class CashManagementModule {}
