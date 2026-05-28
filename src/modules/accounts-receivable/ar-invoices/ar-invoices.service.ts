import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateArInvoiceDto } from './dto/create-ar-invoice.dto';
import { QueryArInvoiceDto } from './dto/query-ar-invoice.dto';

@Injectable()
export class ArInvoicesService {
  private readonly logger = new Logger(ArInvoicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generateInvoiceNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'INV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'INV', prefix: 'INV', yearMonth, lastNumber: 1 },
    });
    return `INV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: QueryArInvoiceDto) {
    const { page = 1, limit = 20, propertyId, status, guestId, dateFrom, dateTo, search } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (guestId) where.guestId = guestId;
    if (dateFrom || dateTo) {
      where.issueDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search } },
        { companyName: { contains: search } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.arInvoice.count({ where }),
      this.prisma.arInvoice.findMany({
        where,
        include: {
          guest: { select: { id: true, firstName: true, lastName: true } },
          lines: true,
        },
        orderBy: [{ issueDate: 'desc' }, { invoiceNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const invoice = await this.prisma.arInvoice.findFirst({
      where: { id, tenantId },
      include: {
        lines: true,
        guest: { select: { id: true, firstName: true, lastName: true } },
        receipts: { include: { receipt: true } },
      },
    });
    if (!invoice) throw new NotFoundException(`AR Invoice ${id} not found`);
    return invoice;
  }

  async create(dto: CreateArInvoiceDto, tenantId: string, createdBy: string) {
    let subtotal = 0;
    let vatAmount = 0;

    const lineData = dto.lines.map((line, i) => {
      const discount = line.discountAmt ?? 0;
      const vatRate = line.vatRate ?? 7;
      const lineSubtotal = line.quantity * line.unitPrice - discount;
      const lineVat = lineSubtotal * (vatRate / 100);
      subtotal += lineSubtotal;
      vatAmount += lineVat;

      return {
        lineNo: i + 1,
        description: line.description,
        chargeType: line.chargeType,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmt: discount,
        subtotal: lineSubtotal,
        vatRate,
        vatAmount: lineVat,
        totalAmount: lineSubtotal + lineVat,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        sourceRef: line.sourceRef,
      };
    });

    const totalAmount = subtotal + vatAmount;
    const invoiceNo = await this.generateInvoiceNo(tenantId);

    const invoice = await this.prisma.$transaction(async (tx) => {
      return tx.arInvoice.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          invoiceNo,
          invoiceType: dto.invoiceType,
          status: 'DRAFT',
          guestId: dto.guestId,
          bookingId: dto.bookingId,
          folioId: dto.folioId,
          companyName: dto.companyName,
          companyTaxId: dto.companyTaxId,
          companyAddress: dto.companyAddress,
          issueDate: new Date(dto.issueDate),
          dueDate: new Date(dto.dueDate),
          currency: dto.currency ?? 'THB',
          exchangeRate: dto.exchangeRate ?? 1,
          subtotal,
          vatAmount,
          totalAmount,
          paidAmount: 0,
          balance: totalAmount,
          notes: dto.notes,
          createdBy,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
    });

    this.logger.log(`Created AR Invoice ${invoiceNo} for tenant ${tenantId}`);
    return invoice;
  }

  async issue(id: string, tenantId: string, issuedBy: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot issue invoice with status: ${invoice.status}`);
    }

    const updated = await this.prisma.arInvoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedBy, issuedAt: new Date() },
    });

    this.logger.log(`AR Invoice ${invoice.invoiceNo} issued by ${issuedBy}`);
    return updated;
  }

  async void(id: string, tenantId: string, voidedBy: string, reason?: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status === 'PAID') {
      throw new BadRequestException('Cannot void a PAID invoice');
    }
    if (invoice.status === 'VOID') {
      throw new BadRequestException('Invoice is already void');
    }

    const updated = await this.prisma.arInvoice.update({
      where: { id },
      data: { status: 'VOID', voidedBy, voidedAt: new Date(), voidReason: reason },
    });

    this.logger.log(`AR Invoice ${invoice.invoiceNo} voided by ${voidedBy}`);
    return updated;
  }

  async getAging(tenantId: string, propertyId: string, asOfDate?: string) {
    const asOf = asOfDate ? new Date(asOfDate) : new Date();

    const invoices = await this.prisma.arInvoice.findMany({
      where: {
        tenantId,
        propertyId,
        status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
        balance: { gt: 0 },
      },
      include: {
        guest: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const aging = invoices.map((inv) => {
      const daysOverdue = Math.floor(
        (asOf.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const balance = Number(inv.balance);

      return {
        invoiceNo: inv.invoiceNo,
        guestId: inv.guestId,
        guest: inv.guest,
        companyName: inv.companyName,
        dueDate: inv.dueDate,
        balance,
        daysOverdue: Math.max(0, daysOverdue),
        bucket: daysOverdue <= 0 ? 'current'
          : daysOverdue <= 30 ? '1_30'
          : daysOverdue <= 60 ? '31_60'
          : daysOverdue <= 90 ? '61_90'
          : 'over_90',
      };
    });

    const summary = {
      current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0, total: 0,
    };
    for (const row of aging) {
      summary[row.bucket as keyof typeof summary] += row.balance;
      summary.total += row.balance;
    }

    return { asOfDate: asOf, summary, items: aging };
  }
}
