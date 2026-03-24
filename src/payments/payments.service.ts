import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createPaymentDto: CreatePaymentDto) {
    const data: any = {
      invoice_id: createPaymentDto.invoiceId,
      method: createPaymentDto.method,
      slip_url: createPaymentDto.slipUrl,
      status: createPaymentDto.status,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.payments.create({
      data,
      include: { invoices: true },
    });
  }

  findAll() {
    return this.prisma.payments.findMany({
      include: { invoices: true },
    });
  }

  findOne(id: string) {
    return this.prisma.payments.findUnique({
      where: { id },
      include: { invoices: true },
    });
  }

  findByInvoiceId(invoiceId: string) {
    return this.prisma.payments.findMany({
      where: { invoice_id: invoiceId },
      orderBy: { created_at: 'desc' },
    });
  }

  update(id: string, updatePaymentDto: UpdatePaymentDto) {
    const data: any = {
      invoice_id: updatePaymentDto.invoiceId,
      method: updatePaymentDto.method,
      slip_url: updatePaymentDto.slipUrl,
      status: updatePaymentDto.status,
    };

    // Clean up undefined properties
    Object.keys(data).forEach(key => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.payments.update({
      where: { id },
      data,
      include: { invoices: true },
    });
  }

  async approvePayment(id: string, adminId: string) {
    const payment = await this.findOne(id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    return this.prisma.payments.update({
      where: { id },
      data: {
        status: PaymentStatus.APPROVED,
        approved_by: adminId,
        approved_at: new Date(),
      },
      include: { invoices: true },
    });
  }

  async rejectPayment(id: string, adminId: string) {
    const payment = await this.findOne(id);
    if (!payment) {
      throw new Error('Payment not found');
    }

    return this.prisma.payments.update({
      where: { id },
      data: {
        status: PaymentStatus.REJECTED,
        approved_by: adminId,
        approved_at: new Date(),
      },
      include: { invoices: true },
    });
  }

  remove(id: string) {
    return this.prisma.payments.delete({
      where: { id },
    });
  }
}


