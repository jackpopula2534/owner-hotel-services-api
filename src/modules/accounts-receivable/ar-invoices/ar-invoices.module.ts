import { Module } from '@nestjs/common';
import { ArInvoicesController } from './ar-invoices.controller';
import { ArInvoicesService } from './ar-invoices.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [ArInvoicesController],
  providers: [ArInvoicesService],
  exports: [ArInvoicesService],
})
export class ArInvoicesModule {}
