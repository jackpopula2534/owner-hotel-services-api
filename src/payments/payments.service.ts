import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private paymentsRepository: Repository<Payment>,
  ) {}

  create(createPaymentDto: CreatePaymentDto): Promise<Payment> {
    const payment = this.paymentsRepository.create(createPaymentDto);
    return this.paymentsRepository.save(payment);
  }

  findAll(): Promise<Payment[]> {
    return this.paymentsRepository.find({
      relations: ['invoice', 'approver'],
    });
  }

  findOne(id: string): Promise<Payment> {
    return this.paymentsRepository.findOne({
      where: { id },
      relations: ['invoice', 'approver'],
    });
  }

  findByInvoiceId(invoiceId: string): Promise<Payment[]> {
    return this.paymentsRepository.find({
      where: { invoiceId },
      relations: ['approver'],
      order: { createdAt: 'DESC' },
    });
  }

  update(id: string, updatePaymentDto: UpdatePaymentDto): Promise<Payment> {
    return this.paymentsRepository.save({
      id,
      ...updatePaymentDto,
    });
  }

  async approvePayment(id: string, adminId: string): Promise<Payment> {
    const payment = await this.findOne(id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    payment.status = PaymentStatus.APPROVED;
    payment.approvedBy = adminId;
    payment.approvedAt = new Date();

    return this.paymentsRepository.save(payment);
  }

  async rejectPayment(id: string, adminId: string): Promise<Payment> {
    const payment = await this.findOne(id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    payment.status = PaymentStatus.REJECTED;
    payment.approvedBy = adminId;
    payment.approvedAt = new Date();

    return this.paymentsRepository.save(payment);
  }

  remove(id: string): Promise<void> {
    return this.paymentsRepository.delete(id).then(() => undefined);
  }
}


