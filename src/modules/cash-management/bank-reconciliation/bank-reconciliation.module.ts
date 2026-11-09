import { Module } from '@nestjs/common';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { BankStatementsModule } from '../bank-statements/bank-statements.module';

@Module({
  imports: [AddonModule, BankStatementsModule],
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
