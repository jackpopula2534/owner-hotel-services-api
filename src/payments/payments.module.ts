import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment } from './entities/payment.entity';
import { PaymentRefund } from './entities/payment-refund.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Payment, PaymentRefund]), PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [
    TypeOrmModule, // exports Repository<Payment> + Repository<PaymentRefund>
    PaymentsService,
  ],
})
export class PaymentsModule {}
