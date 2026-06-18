import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateApInvoiceDto } from './dto/create-ap-invoice.dto';
import { QueryApInvoiceDto } from './dto/query-ap-invoice.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class ApInvoicesService {
  private readonly logger = new Logger(ApInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journalEntriesService?: JournalEntriesService,
  ) {}

  private async findDefaultAccountByCode(tenantId: string, code: string) {
    return this.prisma.accountChart.findFirst({
      where: { tenantId, code, isActive: true },
      select: { id: true, code: true, name: true },
    });
  }

  private async generateInvoiceNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'APINV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'APINV', prefix: 'APINV', yearMonth, lastNumber: 1 },
    });
    return `APINV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: QueryApInvoiceDto) {
    const {
      page = 1,
      limit = 20,
      propertyId,
      status,
      supplierId,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.invoiceDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      where.OR = [{ invoiceNo: { contains: search } }, { supplierInvoiceNo: { contains: search } }];
    }

    const [total, data] = await Promise.all([
      this.prisma.apInvoice.count({ where }),
      this.prisma.apInvoice.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true, taxId: true } },
          lines: true,
        },
        orderBy: [{ invoiceDate: 'desc' }, { invoiceNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const invoice = await this.prisma.apInvoice.findFirst({
      where: { id, tenantId },
      include: {
        lines: true,
        supplier: { select: { id: true, name: true, taxId: true, address: true } },
        payments: { include: { payment: true } },
      },
    });
    if (!invoice) throw new NotFoundException(`AP Invoice ${id} not found`);
    return invoice;
  }

  async create(dto: CreateApInvoiceDto, tenantId: string, createdBy: string) {
    let subtotal = 0;
    let vatAmount = 0;
    let whtAmount = 0;

    const lineData = dto.lines.map((line, i) => {
      const discount = line.discountAmt ?? 0;
      const vatRate = line.vatRate ?? 7;
      const whtRate = line.whtRate ?? 0;
      const lineSubtotal = line.quantity * line.unitPrice - discount;
      const lineVat = lineSubtotal * (vatRate / 100);
      const lineWht = lineSubtotal * (whtRate / 100);
      subtotal += lineSubtotal;
      vatAmount += lineVat;
      whtAmount += lineWht;

      return {
        lineNo: i + 1,
        description: line.description,
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmt: discount,
        subtotal: lineSubtotal,
        vatRate,
        vatAmount: lineVat,
        whtRate,
        whtAmount: lineWht,
        totalAmount: lineSubtotal + lineVat,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
      };
    });

    const totalAmount = subtotal + vatAmount;
    const netPayable = totalAmount - whtAmount;
    const invoiceNo = await this.generateInvoiceNo(tenantId);

    const invoice = await this.prisma.$transaction(async (tx) => {
      return tx.apInvoice.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          invoiceNo,
          invoiceType: dto.invoiceType,
          status: 'PENDING',
          supplierId: dto.supplierId,
          purchaseOrderId: dto.purchaseOrderId,
          goodsReceiveId: dto.goodsReceiveId,
          supplierInvoiceNo: dto.supplierInvoiceNo,
          invoiceDate: new Date(dto.invoiceDate),
          dueDate: new Date(dto.dueDate),
          currency: dto.currency ?? 'THB',
          paymentTerms: dto.paymentTerms,
          subtotal,
          vatAmount,
          whtAmount,
          totalAmount,
          netPayable,
          paidAmount: 0,
          balance: netPayable,
          notes: dto.notes,
          createdBy,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
    });

    this.logger.log(`Created AP Invoice ${invoiceNo} for tenant ${tenantId}`);
    return invoice;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const invoice = await this.findOne(id, tenantId);
    if (invoice.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve invoice with status: ${invoice.status}`);
    }

    const updated = await this.prisma.apInvoice.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy, approvedAt: new Date(), isPosted: true, postedAt: new Date() },
    });

    const [apAccount, inputVatAccount, defaultExpenseAccount, whtPayableAccount] = await Promise.all([
      this.findDefaultAccountByCode(tenantId, '2101'),
      this.findDefaultAccountByCode(tenantId, '1106'),
      this.findDefaultAccountByCode(tenantId, '6302'),
      this.findDefaultAccountByCode(tenantId, '2104'),
    ]);

    if (!apAccount || !inputVatAccount || !defaultExpenseAccount) {
      throw new BadRequestException(
        'ไม่สามารถลงบัญชี AP อัตโนมัติได้: กรุณา seed ผังบัญชีมาตรฐานให้ครบก่อน',
      );
    }

    const expenseLines = invoice.lines
      .map((line, index) => ({
        accountId: line.accountId ?? defaultExpenseAccount.id,
        lineNo: index + 1,
        description: line.description,
        debit: Number(line.netAmount),
        credit: 0,
        costCenterId: line.costCenterId ?? undefined,
        subRef: invoice.invoiceNo,
      }))
      .filter((line) => line.debit > 0);

    let nextLineNo = expenseLines.length + 1;
    const journalLines = [
      ...expenseLines,
      ...(Number(invoice.vatAmount) > 0
        ? [
            {
              accountId: inputVatAccount.id,
              lineNo: nextLineNo++,
              description: `VAT Input ${invoice.invoiceNo}`,
              debit: Number(invoice.vatAmount),
              credit: 0,
              subRef: invoice.invoiceNo,
            },
          ]
        : []),
      ...(Number(invoice.whtAmount) > 0 && whtPayableAccount
        ? [
            {
              accountId: whtPayableAccount.id,
              lineNo: nextLineNo++,
              description: `WHT Payable ${invoice.invoiceNo}`,
              debit: 0,
              credit: Number(invoice.whtAmount),
              subRef: invoice.invoiceNo,
            },
          ]
        : []),
      {
        accountId: apAccount.id,
        lineNo: nextLineNo,
        description: `เจ้าหนี้จาก ${invoice.invoiceNo}`,
        debit: 0,
        credit: Number(invoice.netPayable),
        subRef: invoice.invoiceNo,
      },
    ];

    if (this.journalEntriesService) {
      await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
        propertyId: invoice.propertyId,
        entryDate: invoice.invoiceDate,
        description: `อนุมัติ AP Invoice ${invoice.invoiceNo}`,
        reference: invoice.invoiceNo,
        sourceType: JournalSourceTypeEnum.AP_PAYMENT,
        sourceId: invoice.id,
        createdBy: approvedBy,
        lines: journalLines,
      });
    }

    this.logger.log(`AP Invoice ${invoice.invoiceNo} approved by ${approvedBy}`);
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

    const updated = await this.prisma.apInvoice.update({
      where: { id },
      data: { status: 'VOID', voidedBy, voidedAt: new Date(), voidReason: reason },
    });

    this.logger.log(`AP Invoice ${invoice.invoiceNo} voided by ${voidedBy}`);
    return updated;
  }

  async getAging(tenantId: string, propertyId: string, asOfDate?: string) {
    const asOf = asOfDate ? new Date(asOfDate) : new Date();

    const invoices = await this.prisma.apInvoice.findMany({
      where: {
        tenantId,
        propertyId,
        status: { in: ['APPROVED', 'PARTIAL', 'OVERDUE'] },
        balance: { gt: 0 },
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    const aging = invoices.map((inv) => {
      const daysOverdue = Math.floor(
        (asOf.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const balance = Number(inv.balance);

      return {
        invoiceNo: inv.invoiceNo,
        supplierId: inv.supplierId,
        supplier: inv.supplier,
        dueDate: inv.dueDate,
        balance,
        daysOverdue: Math.max(0, daysOverdue),
        bucket:
          daysOverdue <= 0
            ? 'current'
            : daysOverdue <= 30
              ? '1_30'
              : daysOverdue <= 60
                ? '31_60'
                : daysOverdue <= 90
                  ? '61_90'
                  : 'over_90',
      };
    });

    const summary = {
      current: 0,
      '1_30': 0,
      '31_60': 0,
      '61_90': 0,
      over_90: 0,
      total: 0,
    };
    for (const row of aging) {
      summary[row.bucket as keyof typeof summary] += row.balance;
      summary.total += row.balance;
    }

    return { asOfDate: asOf, summary, items: aging };
  }
}
