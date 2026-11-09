import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { ApInvoiceStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateApInvoiceDto } from './dto/create-ap-invoice.dto';
import { QueryApInvoiceDto } from './dto/query-ap-invoice.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { ensureDefaultChartOfAccounts } from '@/modules/accounting/chart-of-accounts/default-chart-of-accounts';
import { toBangkokDate } from '@/common/utils/bangkok-day.util';
import { findSourceJournals } from '../ap-journals.util';

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

/** ใบที่ตั้งเจ้าหนี้แล้วและยังจ่ายไม่ครบ */
const OPEN_STATUSES: ApInvoiceStatus[] = ['APPROVED', 'PARTIAL', 'OVERDUE'];

const todayUtcMidnight = (): Date => new Date(`${toBangkokDate(new Date())}T00:00:00.000Z`);

/** สถานะ OVERDUE ไม่มีงานไหนปั๊มให้ — คิดจากวันครบกำหนดเทียบวันนี้ (เวลาไทย) */
function daysOverdueOf(inv: { status: string; balance: unknown; dueDate: Date }, today: Date): number {
  if (!OPEN_STATUSES.includes(inv.status as ApInvoiceStatus) || Number(inv.balance) <= 0) return 0;
  const days = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

@Injectable()
export class ApInvoicesService {
  private readonly logger = new Logger(ApInvoicesService.name);

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
      bucket,
    } = query;
    const skip = (page - 1) * limit;
    const today = todayUtcMidnight();

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (bucket) {
      where.status = { in: OPEN_STATUSES };
      where.balance = { gt: 0 };
      if (bucket === 'OVERDUE') where.dueDate = { lt: today };
    }
    if (supplierId) where.supplierId = supplierId;
    if (dateFrom || dateTo) {
      where.invoiceDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { invoiceNo: { contains: search } },
        { supplierInvoiceNo: { contains: search } },
        { supplier: { name: { contains: search } } },
        { supplier: { taxId: { contains: search } } },
      ];
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

    const rows = data.map((inv) => ({ ...inv, daysOverdue: daysOverdueOf(inv, today) }));
    return { data: rows, total, page, limit };
  }

  /** รายละเอียดสำหรับแผงข้าง: ใบสำคัญจ่ายที่ตัดใบนี้ + รายการบัญชี (รวมรายการกลับเมื่อยกเลิก) */
  async findDetail(id: string, tenantId: string) {
    const invoice = await this.prisma.apInvoice.findFirst({
      where: { id, tenantId },
      include: {
        lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } },
        supplier: { select: { id: true, name: true, taxId: true, address: true } },
        payments: {
          include: {
            payment: { select: { id: true, paymentNo: true, paymentDate: true, method: true, status: true } },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException(`AP Invoice ${id} not found`);
    const journals = await findSourceJournals(this.prisma, tenantId, 'AP_INVOICE', invoice.id);
    return { ...invoice, daysOverdue: daysOverdueOf(invoice, todayUtcMidnight()), journals };
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
      // ปัดเป็นสตางค์ต่อบรรทัดแล้วค่อยรวม — หัวใบต้องเท่ากับผลรวมบรรทัดที่บันทึกจริง
      // ไม่งั้นรายการบัญชีตอนอนุมัติ (อ่านจากบรรทัด) ต่างจากยอดเจ้าหนี้ 0.01 แล้วไม่บาลานซ์
      const lineSubtotal = roundMoney(line.quantity * line.unitPrice - discount);
      const lineVat = roundMoney(lineSubtotal * (vatRate / 100));
      const lineWht = roundMoney(lineSubtotal * (whtRate / 100));
      subtotal = roundMoney(subtotal + lineSubtotal);
      vatAmount = roundMoney(vatAmount + lineVat);
      whtAmount = roundMoney(whtAmount + lineWht);

      return {
        lineNo: i + 1,
        description: line.description,
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmt: discount,
        // คอลัมน์ของบรรทัดชื่อ netAmount (เดิมส่ง subtotal → Prisma ปฏิเสธ สร้างใบไม่ได้เลย)
        netAmount: lineSubtotal,
        vatRate,
        vatAmount: lineVat,
        whtRate,
        whtAmount: lineWht,
        totalAmount: roundMoney(lineSubtotal + lineVat),
        accountId: line.accountId,
        costCenterId: line.costCenterId,
      };
    });

    const totalAmount = roundMoney(subtotal + vatAmount);
    const netPayable = roundMoney(totalAmount - whtAmount);
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
          taxableAmount: subtotal,
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

    const [apAccount, inputVatAccount, defaultExpenseAccount, whtPayableAccount] = await Promise.all([
      this.findDefaultAccountByCode(tenantId, '2101'),
      this.findDefaultAccountByCode(tenantId, '1106'),
      this.findDefaultAccountByCode(tenantId, '6302'),
      this.findDefaultAccountByCode(tenantId, '2104'),
    ]);

    // ไม่มีบัญชี 2104 แต่ใบมี WHT → JE ไม่สมดุล (เครดิตเจ้าหนี้แค่ยอดสุทธิ) ต้องล้มพร้อมข้อความชัด ๆ
    if (!apAccount || !inputVatAccount || !defaultExpenseAccount || (Number(invoice.whtAmount) > 0 && !whtPayableAccount)) {
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
      ...(Number(invoice.whtAmount) > 0
        ? [
            {
              accountId: whtPayableAccount!.id,
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
        sourceType: JournalSourceTypeEnum.AP_INVOICE,
        sourceId: invoice.id,
        createdBy: approvedBy,
        lines: journalLines,
      });
    }

    // อนุมัติหลังลงบัญชีสำเร็จ — งวดปิด/ผังบัญชีไม่ครบต้องไม่ทิ้งใบ APPROVED ที่ไม่มีรายการบัญชี
    const updated = await this.prisma.apInvoice.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy, approvedAt: new Date(), isPosted: true, postedAt: new Date() },
    });

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

    if (Number(invoice.paidAmount) > 0) {
      throw new BadRequestException('ใบแจ้งหนี้มีการจ่ายชำระแล้ว ต้องยกเลิกใบสำคัญจ่ายก่อน');
    }

    const pendingPayments = await this.prisma.apPaymentAllocation.count({
      where: { tenantId, invoiceId: invoice.id, payment: { status: 'PENDING' } },
    });
    if (pendingPayments > 0) {
      throw new BadRequestException('ใบแจ้งหนี้มีใบสำคัญจ่ายรออนุมัติอยู่ ต้องยกเลิกใบสำคัญจ่ายก่อน');
    }

    // ใบที่อนุมัติแล้วตั้งเจ้าหนี้ไว้ในสมุดรายวัน — ต้องกลับรายการด้วย
    await this.journalEntriesService?.reverseBySource(
      tenantId,
      JournalSourceTypeEnum.AP_INVOICE,
      invoice.id,
      voidedBy,
      `ยกเลิก AP Invoice ${invoice.invoiceNo}`,
    );

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
        status: { in: OPEN_STATUSES },
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
