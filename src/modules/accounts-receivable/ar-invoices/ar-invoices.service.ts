import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateArInvoiceDto } from './dto/create-ar-invoice.dto';
import { QueryArInvoiceDto } from './dto/query-ar-invoice.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';

@Injectable()
export class ArInvoicesService {
  private readonly logger = new Logger(ArInvoicesService.name);

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
      where.OR = [{ invoiceNo: { contains: search } }, { companyName: { contains: search } }];
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

    // LEGAL-03: a Thai full tax invoice (ใบกำกับภาษีเต็มรูป) is invalid without the
    // SELLER's tax ID. Block issuance until Document Settings for this property
    // carries a Tax ID — otherwise we'd emit a non-compliant document.
    const settings = await this.prisma.documentSettings.findFirst({
      where: { tenantId, propertyId: invoice.propertyId },
      select: { taxId: true },
    });
    if (!settings?.taxId || settings.taxId.trim() === '') {
      throw new BadRequestException(
        'ไม่สามารถออกใบกำกับภาษีได้: กรุณาตั้งเลขประจำตัวผู้เสียภาษี (Tax ID) ของผู้ขายใน Document Settings ของสาขานี้ก่อน',
      );
    }

    // LEGAL-03: City Ledger (B2B) invoices must carry the BUYER's tax ID to be a
    // valid full tax invoice for the company claiming input VAT.
    if (invoice.invoiceType === 'CITY_LEDGER') {
      const buyerTaxId = (invoice.companyTaxId ?? '').trim();
      if (!buyerTaxId) {
        throw new BadRequestException(
          'ไม่สามารถออกใบกำกับภาษีแบบ City Ledger ได้: ต้องระบุเลขประจำตัวผู้เสียภาษีของบริษัทผู้ซื้อ (companyTaxId)',
        );
      }
    }

    const updated = await this.prisma.arInvoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedBy, issuedAt: new Date(), isPosted: true, postedAt: new Date() },
    });

    const arAccountCode = invoice.invoiceType === 'CITY_LEDGER' ? '1104' : '1103';
    const [arAccount, outputVatAccount, defaultRevenueAccount] = await Promise.all([
      this.findDefaultAccountByCode(tenantId, arAccountCode),
      this.findDefaultAccountByCode(tenantId, '2103'),
      this.findDefaultAccountByCode(tenantId, '4101'),
    ]);

    if (!arAccount || !outputVatAccount || !defaultRevenueAccount) {
      throw new BadRequestException(
        'ไม่สามารถลงบัญชี AR อัตโนมัติได้: กรุณา seed ผังบัญชีมาตรฐานให้ครบก่อน',
      );
    }

    const revenueLines = invoice.lines
      .map((line, index) => ({
        accountId: line.accountId ?? defaultRevenueAccount.id,
        lineNo: index + 2,
        description: line.description,
        debit: 0,
        credit: Number(line.netAmount),
        costCenterId: line.costCenterId ?? undefined,
        subRef: line.sourceRef ?? invoice.invoiceNo,
      }))
      .filter((line) => line.credit > 0);

    const journalLines = [
      {
        accountId: arAccount.id,
        lineNo: 1,
        description: `ลูกหนี้จาก ${invoice.invoiceNo}`,
        debit: Number(invoice.totalAmount),
        credit: 0,
        subRef: invoice.invoiceNo,
      },
      ...revenueLines,
      ...(Number(invoice.vatAmount) > 0
        ? [
            {
              accountId: outputVatAccount.id,
              lineNo: revenueLines.length + 2,
              description: `VAT Output ${invoice.invoiceNo}`,
              debit: 0,
              credit: Number(invoice.vatAmount),
              subRef: invoice.invoiceNo,
            },
          ]
        : []),
    ];

    if (this.journalEntriesService) {
      await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
        propertyId: invoice.propertyId,
        entryDate: invoice.issueDate,
        description: `ออก AR Invoice ${invoice.invoiceNo}`,
        reference: invoice.invoiceNo,
        sourceType: JournalSourceTypeEnum.AR_RECEIPT,
        sourceId: invoice.id,
        createdBy: issuedBy,
        lines: journalLines,
      });
    }

    this.logger.log(`AR Invoice ${invoice.invoiceNo} issued by ${issuedBy}`);
    return updated;
  }

  /**
   * LEGAL-03: detect gaps / duplicates in the sequential invoice numbering.
   * The Thai Revenue Department requires a gapless, non-reused running number
   * per document series. For each INV sequence we compare the consumed numbers
   * (1..lastNumber) against the invoice numbers actually present in the DB.
   */
  async detectSequenceGaps(
    tenantId: string,
    opts: { yearMonth?: string } = {},
  ): Promise<{
    tenantId: string;
    ok: boolean;
    sequences: Array<{
      yearMonth: string;
      lastNumber: number;
      invoiceCount: number;
      missing: number[];
      duplicates: number[];
      hasIssues: boolean;
    }>;
  }> {
    const sequences = await this.prisma.documentSequence.findMany({
      where: {
        tenantId,
        docType: 'INV',
        ...(opts.yearMonth ? { yearMonth: opts.yearMonth } : {}),
      },
    });

    const results = [];
    for (const seq of sequences) {
      const invoices = await this.prisma.arInvoice.findMany({
        where: { tenantId, invoiceNo: { startsWith: `INV-${seq.yearMonth}-` } },
        select: { invoiceNo: true },
      });

      const counts = new Map<number, number>();
      for (const inv of invoices) {
        const match = inv.invoiceNo.match(/-(\d{6})$/);
        if (!match) continue;
        const n = parseInt(match[1], 10);
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }

      const missing: number[] = [];
      for (let n = 1; n <= seq.lastNumber; n++) {
        if (!counts.has(n)) missing.push(n);
      }
      const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);

      results.push({
        yearMonth: seq.yearMonth,
        lastNumber: seq.lastNumber,
        invoiceCount: invoices.length,
        missing,
        duplicates,
        hasIssues: missing.length > 0 || duplicates.length > 0,
      });
    }

    return { tenantId, ok: results.every((r) => !r.hasIssues), sequences: results };
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
