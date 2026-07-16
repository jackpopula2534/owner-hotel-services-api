import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AddonModule } from '@/modules/addons/addon.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentRefund } from './entities/payment-refund.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentRefund]),
    PrismaModule,
    EmailModule,
    AuditLogModule,
    AddonModule, // entitlement cache — dropped when a payment activates a subscription
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [TypeOrmModule, PaymentsService],
})
export class PaymentsModule {}
