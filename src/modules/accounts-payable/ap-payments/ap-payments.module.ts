import { Module } from '@nestjs/common';
import { ApPaymentsController } from './ap-payments.controller';
import { ApPaymentsService } from './ap-payments.service';
import { AddonModule } from '@/modules/addons/addon.module';
import { AccountingModule } from '@/modules/accounting/accounting.module';

@Module({
  imports: [AddonModule, AccountingModule],
  controllers: [ApPaymentsController],
  providers: [ApPaymentsService],
  exports: [ApPaymentsService],
})
export class ApPaymentsModule {}
