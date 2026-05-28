import { Module } from '@nestjs/common';
import { ArInvoicesController } from './ar-invoices.controller';
import { ArInvoicesService } from './ar-invoices.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [ArInvoicesController],
  providers: [ArInvoicesService],
  exports: [ArInvoicesService],
})
export class ArInvoicesModule {}
