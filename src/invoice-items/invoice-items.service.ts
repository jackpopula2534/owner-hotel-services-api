import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceItemDto } from './dto/create-invoice-item.dto';

@Injectable()
export class InvoiceItemsService {
  constructor(private readonly prisma: PrismaService) {}

  create(createInvoiceItemDto: CreateInvoiceItemDto) {
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    // Map camelCase DTO → Prisma snake_case columns. `unit_price` is required
    // and has no DB default, so fall back to `amount` when the caller omits it.
    // (The previous `dto as any` passthrough wrote `invoiceId`/`refId` — fields
    // Prisma rejects — and never set `unit_price`, so every create threw and the
    // discount line items were silently lost.)
    return this.prisma.invoice_items.create({
      data: {
        invoice_id: createInvoiceItemDto.invoiceId,
        type: createInvoiceItemDto.type,
        description: createInvoiceItemDto.description,
        quantity: createInvoiceItemDto.quantity ?? 1,
        unit_price: round2(createInvoiceItemDto.unitPrice ?? createInvoiceItemDto.amount),
        amount: round2(createInvoiceItemDto.amount),
        ref_id: createInvoiceItemDto.refId,
      },
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
