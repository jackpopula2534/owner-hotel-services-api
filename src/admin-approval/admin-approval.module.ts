import { Module } from '@nestjs/common';
import { AdminApprovalService } from './admin-approval.service';
import { AdminApprovalController } from './admin-approval.controller';
import { PaymentsModule } from '../payments/payments.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AdminsModule } from '../admins/admins.module';

@Module({
  imports: [PaymentsModule, InvoicesModule, SubscriptionsModule, AdminsModule],
  controllers: [AdminApprovalController],
  providers: [AdminApprovalService],
  exports: [AdminApprovalService],
})
export class AdminApprovalModule {}


