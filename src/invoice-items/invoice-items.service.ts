import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';

@Injectable()
export class InvoiceItemsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createInvoiceItemDto: CreateInvoiceItemDto) {
    return this.prisma.invoice_items.create({
      data: createInvoiceItemDto as any,
      include: { invoices: true },
    });
  }

  findAll() {
    return this.prisma.invoice_items.findMany({
      include: { invoices: true },
    });
  }

  findByInvoiceId(invoiceId: string) {
    return this.prisma.invoice_items.findMany({
      where: { invoice_id: invoiceId },
    });
  }

  remove(id: string) {
    return this.prisma.invoice_items.delete({
      where: { id },
    });
  }
}
