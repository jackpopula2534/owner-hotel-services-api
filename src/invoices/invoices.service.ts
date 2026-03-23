import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  create(createInvoiceDto: CreateInvoiceDto) {
    return this.prisma.invoices.create({
      data: createInvoiceDto as any,
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
    return this.prisma.invoices.update({
      where: { id },
      data: updateInvoiceDto,
      include: { tenants: true, subscriptions: true, invoice_items: true, payments: true },
    });
  }

  remove(id: string) {
    return this.prisma.invoices.delete({
      where: { id },
    });
  }
}


