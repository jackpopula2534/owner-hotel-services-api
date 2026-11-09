import { Module } from '@nestjs/common';
import { ApInvoicesController } from './ap-invoices.controller';
import { ApInvoicesService } from './ap-invoices.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [ApInvoicesController],
  providers: [ApInvoicesService],
  exports: [ApInvoicesService],
})
export class ApInvoicesModule {}
