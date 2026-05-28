import { Module } from '@nestjs/common';
import { ApInvoicesController } from './ap-invoices.controller';
import { ApInvoicesService } from './ap-invoices.service';
import { AddonModule } from '@/modules/addons/addon.module';

@Module({
  imports: [AddonModule],
  controllers: [ApInvoicesController],
  providers: [ApInvoicesService],
  exports: [ApInvoicesService],
})
export class ApInvoicesModule {}
