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
import { ensureDefaultChartOfAccounts } from '@/modules/accounting/chart-of-accounts/default-chart-of-accounts';
import { toBangkokDate } from '@/common/utils/bangkok-day.util';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import { settleInvoice } from '../ar-invoice-balance.util';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class ArInvoicesService {
  private readonly logger = new Logger(ArInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journalEntriesService?: JournalEntriesService,
  ) {}

  private async findDefaultAccountByCode(tenantId: string, code: string) {
    await ensureDefaultChartOfAccounts(this.prisma, tenantId);
    return this.prisma.accountChart.findFirst({
      where: { tenantId, code, isActive: true },
      select: { id: true, code: true, name: true },
    });
  }

  /** เลขที่ใบแจ้งหนี้ถัดไป (ใช้ร่วมกับ CityLedgerBillingService) */
  async generateInvoiceNo(tenantId: string): Promise<string> {
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
    const {
      page = 1,
      limit = 20,
      propertyId,
      status,
      guestId,
      dateFrom,
      dateTo,
      search,
      bucket,
    } = query;
    const skip = (page - 1) * limit;
    const today = new Date(`${toBangkokDate(new Date())}T00:00:00.000Z`);

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (bucket) {
      // สถานะ OVERDUE ไม่มีงานไหนปั๊มให้ — ใช้วันครบกำหนดตัดสินแทน
      where.status = { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] };
      where.balance = { gt: 0 };
      if (bucket === 'OVERDUE') where.dueDate = { lt: today };
    }
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
        { companyTaxId: { contains: search } },
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

    const rows = data.map((inv) => {
      const open = ['ISSUED', 'PARTIAL', 'OVERDUE'].includes(inv.status) && Number(inv.balance) > 0;
      const days = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
      return {
        ...inv,
        daysOverdue: open && days > 0 ? days : 0,
        fromFolio:
          inv.lines.length > 0 && inv.lines.every((l) => l.sourceRef?.startsWith('FOLIO_PAYMENT:')),
      };
    });

    return { data: rows, total, page, limit };
  }

  /** โหลดใบพร้อมบรรทัด/การรับชำระ — ใช้ภายใน (issue/void) ไม่ต้องดึง JE */
  private async loadInvoice(id: string, tenantId: string) {
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
    const journal = await this.prisma.journalEntry.findFirst({
      where: { tenantId, sourceType: 'AR_INVOICE', sourceId: invoice.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        entryNo: true,
        status: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          select: { debit: true, credit: true, account: { select: { code: true, name: true } } },
        },
      },
    });
    const fromFolio =
      invoice.lines.length > 0 &&
      invoice.lines.every((line) => line.sourceRef?.startsWith('FOLIO_PAYMENT:'));
    const creditNoteSelect = {
      id: true,
      invoiceNo: true,
      issueDate: true,
      totalAmount: true,
      status: true,
      notes: true,
    } as const;
    const [creditNotes, refInvoice] = await Promise.all([
      this.prisma.arInvoice.findMany({
        where: { tenantId, refInvoiceId: invoice.id, invoiceType: 'CREDIT_NOTE' },
        orderBy: { createdAt: 'asc' },
        select: creditNoteSelect,
      }),
      invoice.refInvoiceId
        ? this.prisma.arInvoice.findFirst({
            where: { id: invoice.refInvoiceId, tenantId },
            select: creditNoteSelect,
          })
        : Promise.resolve(null),
    ]);
    return { ...invoice, fromFolio, journalEntry: journal, creditNotes, refInvoice };
  }

  async create(dto: CreateArInvoiceDto, tenantId: string, createdBy: string) {
    if (dto.invoiceType === 'CREDIT_NOTE') {
      throw new BadRequestException('ใบลดหนี้ต้องออกจากใบแจ้งหนี้ต้นทาง (POST :id/credit-note)');
    }
    let subtotal = 0;
    let vatAmount = 0;

    const lineData = dto.lines.map((line, i) => {
      const discount = line.discountAmt ?? 0;
      const vatRate = line.vatRate ?? 7;
      // ปัดเป็นสตางค์ต่อบรรทัดแล้วค่อยรวม — หัวใบต้องเท่ากับผลรวมบรรทัดที่บันทึกจริง
      // ไม่งั้นรายการบัญชีตอนออกใบ (อ่านจากบรรทัด) ต่างจากยอดลูกหนี้ 0.01 แล้วไม่บาลานซ์
      const lineSubtotal = roundMoney(line.quantity * line.unitPrice - discount);
      const lineVat = roundMoney(lineSubtotal * (vatRate / 100));
      subtotal = roundMoney(subtotal + lineSubtotal);
      vatAmount = roundMoney(vatAmount + lineVat);

      return {
        lineNo: i + 1,
        description: line.description,
        chargeType: line.chargeType,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmt: discount,
        // คอลัมน์ของบรรทัดชื่อ netAmount (เดิมส่ง subtotal → Prisma ปฏิเสธ สร้างใบไม่ได้เลย)
        netAmount: lineSubtotal,
        vatRate,
        vatAmount: lineVat,
        totalAmount: roundMoney(lineSubtotal + lineVat),
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        sourceRef: line.sourceRef,
      };
    });

    const totalAmount = roundMoney(subtotal + vatAmount);
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
          taxableAmount: subtotal,
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
    const invoice = await this.loadInvoice(id, tenantId);
    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot issue invoice with status: ${invoice.status}`);
    }
    if (invoice.invoiceType === 'CREDIT_NOTE') {
      // ทางนี้ลง Dr ลูกหนี้ / Cr รายได้ — ใบลดหนี้ต้องกลับด้าน ห้ามออกผ่านที่นี่
      throw new BadRequestException('ใบลดหนี้ออกผ่าน POST :id/credit-note เท่านั้น');
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

    // ใบรวบยอดจาก Folio: รายได้รับรู้แล้วตอน Night Audit และยอดอยู่ใน 1103/1104 แล้ว
    // ออกใบเป็นเอกสารวางบิลอย่างเดียว — ลง JE ซ้ำจะทำให้รายได้ขึ้นสองเท่า
    const fromFolio =
      invoice.lines.length > 0 &&
      invoice.lines.every((line) => line.sourceRef?.startsWith('FOLIO_PAYMENT:'));
    if (fromFolio) {
      const issued = await this.prisma.arInvoice.update({
        where: { id },
        data: { status: 'ISSUED', issuedBy, issuedAt: new Date(), isPosted: false },
      });
      this.logger.log(
        `AR Invoice ${invoice.invoiceNo} issued (from folio, no journal) by ${issuedBy}`,
      );
      return issued;
    }

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
        sourceType: JournalSourceTypeEnum.AR_INVOICE,
        sourceId: invoice.id,
        createdBy: issuedBy,
        lines: journalLines,
      });
    }

    // เปลี่ยนสถานะหลังลงบัญชีสำเร็จ — ถ้างวดปิดแล้ว/ผังบัญชีไม่ครบ ใบต้องยังเป็น DRAFT
    // ไม่ใช่ ISSUED ที่ไม่มีรายการบัญชีรองรับ (ลงซ้ำได้: createAndPostAutoEntry กันซ้ำตาม source)
    const updated = await this.prisma.arInvoice.update({
      where: { id },
      data: {
        status: 'ISSUED',
        issuedBy,
        issuedAt: new Date(),
        isPosted: true,
        postedAt: new Date(),
      },
    });

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
    const invoice = await this.loadInvoice(id, tenantId);
    if (invoice.status === 'PAID') {
      throw new BadRequestException('Cannot void a PAID invoice');
    }
    if (invoice.status === 'VOID') {
      throw new BadRequestException('Invoice is already void');
    }

    if (invoice.invoiceType === 'CREDIT_NOTE') {
      return this.voidCreditNote(invoice, tenantId, voidedBy, reason);
    }

    if (Number(invoice.paidAmount) > 0) {
      throw new BadRequestException('ใบแจ้งหนี้มีการรับชำระแล้ว ต้องยกเลิกใบเสร็จก่อน');
    }
    if (Number(invoice.creditedAmount) > 0) {
      throw new BadRequestException('ใบแจ้งหนี้มีใบลดหนี้อ้างอยู่ ต้องยกเลิกใบลดหนี้ก่อน');
    }

    // ใบที่ออกแล้วตั้งลูกหนี้ไว้ในสมุดรายวัน — ยกเลิกใบโดยไม่กลับรายการ ลูกหนี้จะค้างในงบตลอดไป
    await this.journalEntriesService?.reverseBySource(
      tenantId,
      JournalSourceTypeEnum.AR_INVOICE,
      invoice.id,
      voidedBy,
      `ยกเลิก AR Invoice ${invoice.invoiceNo}`,
    );

    const updated = await this.prisma.arInvoice.update({
      where: { id },
      data: { status: 'VOID', voidedBy, voidedAt: new Date(), voidReason: reason },
    });

    this.logger.log(`AR Invoice ${invoice.invoiceNo} voided by ${voidedBy}`);
    return updated;
  }

  private async generateCreditNoteNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'CN', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'CN', prefix: 'CN', yearMonth, lastNumber: 1 },
    });
    return `CN-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  /**
   * ออกใบลดหนี้อ้างใบแจ้งหนี้ต้นทาง แล้วตัดยอดคงค้างของใบต้นทางทันที
   *
   * แบ่งยอดลดหนี้ตามสัดส่วนบรรทัดของใบต้นทาง (บัญชีรายได้/VAT เดียวกัน) แล้วลง
   *   Dr รายได้ (ตามบรรทัด) + Dr ภาษีขาย 2103 / Cr ลูกหนี้ 1103|1104
   * ลดได้ไม่เกินยอดคงค้าง — ส่วนที่รับเงินไปแล้วต้องคืนเงิน ไม่ใช่ลดหนี้
   */
  async createCreditNote(
    id: string,
    dto: CreateCreditNoteDto,
    tenantId: string,
    createdBy: string,
  ) {
    const original = await this.loadInvoice(id, tenantId);
    if (original.invoiceType === 'CREDIT_NOTE' || original.invoiceType === 'PROFORMA') {
      throw new BadRequestException(`ออกใบลดหนี้จากเอกสารชนิด ${original.invoiceType} ไม่ได้`);
    }
    if (!['ISSUED', 'PARTIAL', 'OVERDUE'].includes(original.status)) {
      throw new BadRequestException(
        `ออกใบลดหนี้ได้เฉพาะใบที่ออกแล้วและยังค้างชำระ (สถานะ ${original.status})`,
      );
    }
    const amount = roundMoney(dto.amount);
    if (amount - Number(original.balance) > 0.005) {
      throw new BadRequestException(
        `ยอดลดหนี้ ${amount.toFixed(2)} เกินยอดคงค้าง ${Number(original.balance).toFixed(2)}`,
      );
    }
    const sourceLines = original.lines.filter((l) => Number(l.totalAmount) > 0);
    const originalTotal = Number(original.totalAmount);
    if (sourceLines.length === 0 || originalTotal <= 0) {
      throw new BadRequestException('ใบแจ้งหนี้ต้นทางไม่มีบรรทัดรายการให้ลดหนี้');
    }

    const issueDate = new Date(`${dto.issueDate ?? toBangkokDate(new Date())}T00:00:00.000Z`);
    await assertPeriodOpen(this.prisma, tenantId, original.propertyId, issueDate);

    const arAccountCode = original.invoiceType === 'CITY_LEDGER' ? '1104' : '1103';
    const [arAccount, outputVatAccount, defaultRevenueAccount] = await Promise.all([
      this.findDefaultAccountByCode(tenantId, arAccountCode),
      this.findDefaultAccountByCode(tenantId, '2103'),
      this.findDefaultAccountByCode(tenantId, '4101'),
    ]);
    if (!arAccount || !outputVatAccount || !defaultRevenueAccount) {
      throw new BadRequestException('ลงบัญชีใบลดหนี้ไม่ได้: ผังบัญชีไม่มี 1103/1104, 2103 หรือ 4101');
    }

    // แบ่งยอดตามสัดส่วนยอดรวมบรรทัด — บรรทัดสุดท้ายรับเศษสตางค์ ให้รวมแล้วเท่ากับ amount พอดี
    let remainingTotal = amount;
    let remainingVat = roundMoney(amount * (Number(original.vatAmount) / originalTotal));
    const reason = dto.reason.trim();
    const lineData = sourceLines.map((line, i) => {
      const last = i === sourceLines.length - 1;
      const lineTotal = last
        ? remainingTotal
        : roundMoney(amount * (Number(line.totalAmount) / originalTotal));
      const lineVat = last
        ? remainingVat
        : roundMoney(lineTotal * (Number(line.vatAmount) / Number(line.totalAmount)));
      remainingTotal = roundMoney(remainingTotal - lineTotal);
      remainingVat = roundMoney(remainingVat - lineVat);
      const net = roundMoney(lineTotal - lineVat);
      return {
        lineNo: i + 1,
        description: `ลดหนี้: ${reason} (${line.description})`.slice(0, 300),
        chargeType: line.chargeType,
        quantity: 1,
        unitPrice: net,
        discountAmt: 0,
        netAmount: net,
        vatRate: line.vatRate,
        vatAmount: lineVat,
        totalAmount: lineTotal,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        sourceRef: `CN:${original.invoiceNo}`,
      };
    });
    const subtotal = roundMoney(lineData.reduce((s, l) => s + l.netAmount, 0));
    const vatAmount = roundMoney(lineData.reduce((s, l) => s + l.vatAmount, 0));

    const creditNoteNo = await this.generateCreditNoteNo(tenantId);
    const creditNote = await this.prisma.$transaction(async (tx) => {
      // อ่านยอดใหม่ใน tx — กันใบเสร็จ/ใบลดหนี้อื่นที่ตัดยอดไประหว่างตรวจ
      const fresh = await tx.arInvoice.findFirstOrThrow({ where: { id: original.id, tenantId } });
      if (amount - Number(fresh.balance) > 0.005) {
        throw new BadRequestException(
          `ยอดลดหนี้ ${amount.toFixed(2)} เกินยอดคงค้าง ${Number(fresh.balance).toFixed(2)}`,
        );
      }
      const settled = settleInvoice(fresh, { credited: amount });
      await tx.arInvoice.update({
        where: { id: fresh.id },
        data: {
          creditedAmount: settled.creditedAmount,
          balance: settled.balance,
          status: settled.status,
        },
      });
      return tx.arInvoice.create({
        data: {
          tenantId,
          propertyId: original.propertyId,
          invoiceNo: creditNoteNo,
          invoiceType: 'CREDIT_NOTE',
          refInvoiceId: original.id,
          status: 'ISSUED',
          guestId: original.guestId,
          bookingId: original.bookingId,
          folioId: original.folioId,
          companyName: original.companyName,
          companyTaxId: original.companyTaxId,
          companyAddress: original.companyAddress,
          issueDate,
          dueDate: issueDate,
          currency: original.currency,
          exchangeRate: original.exchangeRate,
          subtotal,
          taxableAmount: subtotal,
          vatAmount,
          totalAmount: amount,
          paidAmount: 0,
          balance: 0,
          notes: reason,
          issuedBy: createdBy,
          issuedAt: new Date(),
          createdBy,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
    });

    const description = `ใบลดหนี้ ${creditNoteNo} อ้าง ${original.invoiceNo}`;
    const revenueLines = creditNote.lines
      .filter((l) => Number(l.netAmount) > 0)
      .map((l, i) => ({
        accountId: l.accountId ?? defaultRevenueAccount.id,
        lineNo: i + 1,
        description,
        debit: Number(l.netAmount),
        credit: 0,
        costCenterId: l.costCenterId ?? undefined,
        subRef: creditNoteNo,
      }));
    try {
      if (this.journalEntriesService) {
        await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
          propertyId: creditNote.propertyId,
          entryDate: issueDate,
          description,
          reference: creditNoteNo,
          sourceType: JournalSourceTypeEnum.AR_INVOICE,
          sourceId: creditNote.id,
          createdBy,
          lines: [
            ...revenueLines,
            ...(vatAmount > 0
              ? [
                  {
                    accountId: outputVatAccount.id,
                    lineNo: revenueLines.length + 1,
                    description: `VAT Output ${creditNoteNo}`,
                    debit: vatAmount,
                    credit: 0,
                    subRef: creditNoteNo,
                  },
                ]
              : []),
            {
              accountId: arAccount.id,
              lineNo: revenueLines.length + 2,
              description,
              debit: 0,
              credit: amount,
              subRef: creditNoteNo,
            },
          ],
        });
      }
    } catch (error) {
      // ลงบัญชีไม่ผ่าน → คืนยอดใบต้นทาง + ลบใบลดหนี้ ห้ามมียอดลูกหนี้ลดโดยไม่มี JE
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.arInvoice.findFirstOrThrow({ where: { id: original.id, tenantId } });
        const settled = settleInvoice(fresh, { credited: -amount });
        await tx.arInvoice.update({
          where: { id: fresh.id },
          data: {
            creditedAmount: settled.creditedAmount,
            balance: settled.balance,
            status: settled.status,
          },
        });
        await tx.arInvoice.deleteMany({ where: { id: creditNote.id, tenantId } });
      });
      throw error;
    }

    await this.prisma.arInvoice.updateMany({
      where: { id: creditNote.id, tenantId },
      data: { isPosted: true, postedAt: new Date(), postedBy: createdBy },
    });
    this.logger.log(`Credit note ${creditNoteNo} (${amount}) issued against ${original.invoiceNo}`);
    return this.findOne(creditNote.id, tenantId);
  }

  /** ยกเลิกใบลดหนี้ → กลับรายการ JE แล้วคืนยอดคงค้างให้ใบต้นทาง */
  private async voidCreditNote(
    creditNote: { id: string; invoiceNo: string; refInvoiceId: string | null; totalAmount: unknown },
    tenantId: string,
    voidedBy: string,
    reason?: string,
  ) {
    await this.journalEntriesService?.reverseBySource(
      tenantId,
      JournalSourceTypeEnum.AR_INVOICE,
      creditNote.id,
      voidedBy,
      `ยกเลิกใบลดหนี้ ${creditNote.invoiceNo}`,
    );
    const amount = Number(creditNote.totalAmount);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (creditNote.refInvoiceId) {
        const original = await tx.arInvoice.findFirst({
          where: { id: creditNote.refInvoiceId, tenantId },
        });
        if (original) {
          const settled = settleInvoice(original, { credited: -amount });
          await tx.arInvoice.update({
            where: { id: original.id },
            data: {
              creditedAmount: settled.creditedAmount,
              balance: settled.balance,
              status: settled.status,
            },
          });
        }
      }
      return tx.arInvoice.update({
        where: { id: creditNote.id },
        data: { status: 'VOID', voidedBy, voidedAt: new Date(), voidReason: reason },
      });
    });
    this.logger.log(`Credit note ${creditNote.invoiceNo} voided by ${voidedBy}`);
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
