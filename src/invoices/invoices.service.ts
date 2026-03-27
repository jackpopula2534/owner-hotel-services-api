import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createInvoiceDto: CreateInvoiceDto) {
    const data: any = {
      tenant_id: createInvoiceDto.tenantId,
      subscription_id: createInvoiceDto.subscriptionId,
      invoice_no: createInvoiceDto.invoiceNo,
      amount: createInvoiceDto.amount,
      status: createInvoiceDto.status,
      due_date: createInvoiceDto.dueDate,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.invoices.create({
      data,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  findAll() {
    return this.prisma.invoices.findMany({
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  findOne(id: string) {
    return this.prisma.invoices.findUnique({
      where: { id },
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  findByTenantId(tenantId: string) {
    return this.prisma.invoices.findMany({
      where: { tenant_id: tenantId },
      include: { subscriptions: true, invoice_items: true, payments: true },
      orderBy: { created_at: 'desc' },
    });
  }

  update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const data: any = {
      tenant_id: updateInvoiceDto.tenantId,
      subscription_id: updateInvoiceDto.subscriptionId,
      invoice_no: updateInvoiceDto.invoiceNo,
      amount: updateInvoiceDto.amount,
      status: updateInvoiceDto.status,
      due_date: updateInvoiceDto.dueDate,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.invoices.update({
      where: { id },
      data,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  remove(id: string) {
    return this.prisma.invoices.delete({
      where: { id },
    });
  }
}
