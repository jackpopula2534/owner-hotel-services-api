import { Module } from '@nestjs/common';
import { AddonModule } from '@/modules/addons/addon.module';
import { BankStatementsController } from './bank-statements.controller';
import { BankStatementsService } from './bank-statements.service';

@Module({
  imports: [AddonModule],
  controllers: [BankStatementsController],
  providers: [BankStatementsService],
  exports: [BankStatementsService],
})
export class BankStatementsModule {}
