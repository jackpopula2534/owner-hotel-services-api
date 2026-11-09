import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { ApInvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateApPaymentDto } from './dto/create-ap-payment.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
  settlementAccountCode,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { businessDateOf, shiftDate, shiftMonth, toBangkokDate, toBangkokMonth } from '@/common/utils/bangkok-day.util';
import { findSourceJournals } from '../ap-journals.util';

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

interface PaymentQuery {
  propertyId?: string;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ApPaymentsService {
  private readonly logger = new Logger(ApPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journalEntriesService?: JournalEntriesService,
  ) {}

  private async generatePaymentNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'PV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'PV', prefix: 'PV', yearMonth, lastNumber: 1 },
    });
    return `PV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: PaymentQuery) {
    const { page = 1, limit = 20, propertyId, supplierId, dateFrom, dateTo, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    if (dateFrom || dateTo) {
      where.paymentDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (search) {
      where.OR = [
        { paymentNo: { contains: search } },
        { reference: { contains: search } },
        { supplier: { name: { contains: search } } },
        { allocations: { some: { invoice: { invoiceNo: { contains: search } } } } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.apPayment.count({ where }),
      this.prisma.apPayment.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          allocations: {
            include: { invoice: { select: { invoiceNo: true, totalAmount: true } } },
          },
        },
        orderBy: [{ paymentDate: 'desc' }, { paymentNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  /** รายละเอียดสำหรับแผงข้าง: ใบแจ้งหนี้ที่ตัด + หนังสือรับรอง 50 ทวิ + รายการบัญชี */
  async findDetail(id: string, tenantId: string) {
    const payment = await this.prisma.apPayment.findFirst({
      where: { id, tenantId },
      include: {
        supplier: { select: { id: true, name: true, taxId: true, address: true } },
        allocations: {
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNo: true,
                supplierInvoiceNo: true,
                dueDate: true,
                totalAmount: true,
                netPayable: true,
                balance: true,
                status: true,
              },
            },
          },
        },
        whtCerts: { select: { id: true, certNo: true, status: true, whtAmount: true } },
      },
    });
    if (!payment) throw new NotFoundException(`AP Payment ${id} not found`);
    const journals = await findSourceJournals(this.prisma, tenantId, 'AP_PAYMENT', payment.id);
    return { ...payment, journals };
  }

  /**
   * ตัวเลขหัวหน้าจ่ายชำระ: รออนุมัติ / จ่ายแล้วเดือนนี้ / ภาษีหัก ณ ที่จ่ายเดือนนี้ / เจ้าหนี้ครบกำหนด 7 วัน
   * paymentDate, dueDate เป็น @db.Date → เทียบกับ UTC midnight ของวันไทย
   */
  async summary(tenantId: string, propertyId: string, month?: string) {
    if (!propertyId) throw new BadRequestException('propertyId is required');
    const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : toBangkokMonth(new Date());
    const monthStart = businessDateOf(`${ym}-01`);
    const monthEnd = businessDateOf(`${shiftMonth(ym, 1)}-01`);
    const todayStr = toBangkokDate(new Date());
    const today = businessDateOf(todayStr);
    const weekEnd = businessDateOf(shiftDate(todayStr, 7));
    const openStatuses: ApInvoiceStatus[] = ['APPROVED', 'PARTIAL', 'OVERDUE'];
    const openInvoice = { tenantId, propertyId, status: { in: openStatuses }, balance: { gt: 0 } };

    const [pending, paid, outstanding, overdue, dueSoon, invoicePending] = await Promise.all([
      this.prisma.apPayment.aggregate({
        where: { tenantId, propertyId, status: 'PENDING' },
        _count: { _all: true },
        _sum: { netAmount: true },
      }),
      this.prisma.apPayment.aggregate({
        where: { tenantId, propertyId, status: 'APPROVED', paymentDate: { gte: monthStart, lt: monthEnd } },
        _count: { _all: true },
        _sum: { netAmount: true, whtAmount: true },
      }),
      this.prisma.apInvoice.aggregate({ where: { ...openInvoice }, _count: { _all: true }, _sum: { balance: true } }),
      this.prisma.apInvoice.aggregate({
        where: { ...openInvoice, dueDate: { lt: today } },
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.apInvoice.aggregate({
        where: { ...openInvoice, dueDate: { gte: today, lte: weekEnd } },
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.apInvoice.aggregate({
        where: { tenantId, propertyId, status: 'PENDING' },
        _count: { _all: true },
        _sum: { netPayable: true },
      }),
    ]);

    const num = (v: unknown): number => roundMoney(Number(v ?? 0));
    return {
      month: ym,
      pendingCount: pending._count._all,
      pendingTotal: num(pending._sum.netAmount),
      paidCount: paid._count._all,
      paidTotal: num(paid._sum.netAmount),
      whtTotal: num(paid._sum.whtAmount),
      outstandingCount: outstanding._count._all,
      outstandingTotal: num(outstanding._sum.balance),
      overdueCount: overdue._count._all,
      overdueTotal: num(overdue._sum.balance),
      dueSoonCount: dueSoon._count._all,
      dueSoonTotal: num(dueSoon._sum.balance),
      invoicePendingCount: invoicePending._count._all,
      invoicePendingTotal: num(invoicePending._sum.netPayable),
    };
  }

  /**
   * ตรวจยอดตัดชำระเทียบยอดคงค้างของใบแจ้งหนี้ (หักยอดที่ใบสำคัญจ่ายอื่นที่ยังรออนุมัติจองไว้แล้ว)
   * - ใบแจ้งหนี้ต้องเป็นของผู้ขายเดียวกัน และอนุมัติแล้ว (APPROVED/PARTIAL)
   * - ใบแจ้งหนี้ที่หัก WHT ไว้แล้วตอนอนุมัติ ห้ามหัก WHT ซ้ำที่ใบสำคัญจ่าย
   */
  private async validateAllocations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
    allocations: { invoiceId: string; amount: number }[],
    whtAmount: number,
    excludePaymentId?: string,
  ) {
    const seen = new Set<string>();
    for (const alloc of allocations) {
      if (seen.has(alloc.invoiceId)) {
        throw new BadRequestException('ตัดชำระใบแจ้งหนี้ใบเดียวกันซ้ำในใบสำคัญจ่ายเดียวไม่ได้');
      }
      seen.add(alloc.invoiceId);

      const invoice = await tx.apInvoice.findFirst({ where: { id: alloc.invoiceId, tenantId } });
      if (!invoice) {
        throw new NotFoundException(`AP Invoice ${alloc.invoiceId} not found`);
      }
      if (invoice.supplierId !== supplierId) {
        throw new BadRequestException(`ใบแจ้งหนี้ ${invoice.invoiceNo} ไม่ใช่ของผู้ขายรายนี้`);
      }
      if (!['APPROVED', 'PARTIAL'].includes(invoice.status)) {
        throw new BadRequestException(
          `ตัดชำระใบแจ้งหนี้ ${invoice.invoiceNo} สถานะ ${invoice.status} ไม่ได้ (ต้องอนุมัติแล้วและยังค้างชำระ)`,
        );
      }
      if (whtAmount > 0 && Number(invoice.whtAmount) > 0) {
        throw new BadRequestException(
          `ใบแจ้งหนี้ ${invoice.invoiceNo} หักภาษี ณ ที่จ่ายไว้แล้วตอนอนุมัติ — ห้ามหัก WHT ซ้ำที่ใบสำคัญจ่าย`,
        );
      }

      const reserved = await tx.apPaymentAllocation.aggregate({
        where: {
          tenantId,
          invoiceId: invoice.id,
          payment: {
            status: 'PENDING',
            ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}),
          },
        },
        _sum: { amount: true },
      });
      const available = roundMoney(Number(invoice.balance) - Number(reserved._sum.amount ?? 0));
      if (alloc.amount - available > 0.005) {
        throw new BadRequestException(
          `ยอดตัดชำระ ${alloc.amount} เกินยอดคงค้างที่จ่ายได้ของ ${invoice.invoiceNo} (${available}` +
            `${Number(reserved._sum.amount ?? 0) > 0 ? ' หลังหักใบสำคัญจ่ายที่รออนุมัติ' : ''})`,
        );
      }
    }
  }

  async create(dto: CreateApPaymentDto, tenantId: string, createdBy: string) {
    const whtAmount = roundMoney(dto.whtAmount ?? 0);
    const grossAmount = roundMoney(dto.grossAmount);
    if (whtAmount >= grossAmount) {
      throw new BadRequestException('ยอด WHT ต้องน้อยกว่ายอดจ่ายก่อนหัก');
    }
    const netAmount = roundMoney(grossAmount - whtAmount);
    const allocations = dto.allocations ?? [];
    if (allocations.length > 0) {
      const allocated = roundMoney(allocations.reduce((sum, a) => sum + a.amount, 0));
      if (Math.abs(allocated - grossAmount) > 0.005) {
        throw new BadRequestException(
          `ยอดจ่ายก่อนหัก (${grossAmount}) ต้องเท่ากับยอดตัดชำระรวม (${allocated})`,
        );
      }
    }

    const paymentDate = new Date(dto.paymentDate);
    await assertPeriodOpen(this.prisma, tenantId, dto.propertyId, paymentDate);

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, tenantId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${dto.supplierId} not found`);

    const paymentNo = await this.generatePaymentNo(tenantId);

    // ใบสำคัญจ่ายที่ยังไม่อนุมัติ = ยังไม่มีเงินออก → ไม่แตะยอดคงค้างใบแจ้งหนี้ (ตัดตอนอนุมัติ)
    const payment = await this.prisma.$transaction(async (tx) => {
      await this.validateAllocations(tx, tenantId, dto.supplierId, allocations, whtAmount);

      const newPayment = await tx.apPayment.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          paymentNo,
          supplierId: dto.supplierId,
          paymentDate,
          method: dto.method,
          grossAmount,
          whtAmount,
          netAmount,
          bankAccountId: dto.bankAccountId,
          reference: dto.reference,
          notes: dto.notes,
          status: 'PENDING',
          createdBy,
        },
      });

      for (const alloc of allocations) {
        await tx.apPaymentAllocation.create({
          data: {
            tenantId,
            paymentId: newPayment.id,
            invoiceId: alloc.invoiceId,
            amount: alloc.amount,
          },
        });
      }

      return newPayment;
    });

    this.logger.log(`Created AP Payment ${paymentNo} for tenant ${tenantId}`);
    return payment;
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const payment = await this.prisma.apPayment.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException(`AP Payment ${id} not found`);
    if (payment.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve payment with status: ${payment.status}`);
    }

    const allocations = payment.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amount: Number(a.amount),
    }));
    // ยอดใบแจ้งหนี้อาจเปลี่ยนระหว่างรออนุมัติ (ใบอื่นจ่ายไปก่อน/ใบถูก void) → ตรวจซ้ำก่อนลงบัญชี
    await this.validateAllocations(
      this.prisma,
      tenantId,
      payment.supplierId,
      allocations,
      Number(payment.whtAmount),
      payment.id,
    );

    // อนุมัติ = เงินออกจริง → ลงบัญชีก่อนเปลี่ยนสถานะ (งวดปิด/ผังบัญชีไม่ครบต้องยังเป็น PENDING)
    // DR เจ้าหนี้การค้า = ยอดก่อนหัก, CR เงินสด/ธนาคาร = ยอดจ่ายจริง,
    // CR ภาษีหัก ณ ที่จ่ายค้างจ่าย = WHT ที่หักตอนจ่าย (เฉพาะใบแจ้งหนี้ที่ยังไม่ได้หักตอนอนุมัติ)
    if (this.journalEntriesService) {
      const cashCode = settlementAccountCode(payment.method);
      const accountIds = await resolveAccountIds(this.prisma, tenantId, [
        ACCOUNT_CODES.AP_TRADE,
        cashCode,
        ACCOUNT_CODES.WHT_PAYABLE,
      ]);
      const description = `จ่ายชำระ ${payment.paymentNo}`;
      const wht = Number(payment.whtAmount);
      await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
        propertyId: payment.propertyId,
        entryDate: payment.paymentDate,
        description,
        reference: payment.paymentNo,
        sourceType: JournalSourceTypeEnum.AP_PAYMENT,
        sourceId: payment.id,
        createdBy: approvedBy,
        lines: [
          {
            accountId: accountIds.get(ACCOUNT_CODES.AP_TRADE)!,
            lineNo: 1,
            description,
            debit: Number(payment.grossAmount),
            credit: 0,
            subRef: payment.paymentNo,
          },
          {
            accountId: accountIds.get(cashCode)!,
            lineNo: 2,
            description,
            debit: 0,
            credit: Number(payment.netAmount),
            subRef: payment.paymentNo,
          },
          ...(wht > 0
            ? [
                {
                  accountId: accountIds.get(ACCOUNT_CODES.WHT_PAYABLE)!,
                  lineNo: 3,
                  description: `WHT ${payment.paymentNo}`,
                  debit: 0,
                  credit: wht,
                  subRef: payment.paymentNo,
                },
              ]
            : []),
        ],
      });
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      // กันอนุมัติซ้อน: เปลี่ยนสถานะได้เฉพาะใบที่ยัง PENDING
      const claimed = await tx.apPayment.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedBy,
          approvedAt: now,
          isPosted: !!this.journalEntriesService,
          postedAt: this.journalEntriesService ? now : null,
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('ใบสำคัญจ่ายนี้ถูกอนุมัติหรือยกเลิกไปแล้ว');
      }

      for (const alloc of allocations) {
        const invoice = await tx.apInvoice.findFirstOrThrow({
          where: { id: alloc.invoiceId, tenantId },
        });
        const newPaid = roundMoney(Number(invoice.paidAmount) + alloc.amount);
        const newBalance = roundMoney(Number(invoice.netPayable) - newPaid);
        await tx.apInvoice.update({
          where: { id: invoice.id },
          data: {
            paidAmount: newPaid,
            balance: Math.max(0, newBalance),
            status: newBalance <= 0.005 ? 'PAID' : 'PARTIAL',
          },
        });
      }

      return tx.apPayment.findFirstOrThrow({ where: { id, tenantId } });
    });

    this.logger.log(`AP Payment ${payment.paymentNo} approved by ${approvedBy}`);
    return updated;
  }

  async void(id: string, tenantId: string, voidedBy: string) {
    const payment = await this.prisma.apPayment.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException(`AP Payment ${id} not found`);
    if (payment.status === 'VOID') {
      throw new BadRequestException('Payment is already void');
    }

    // ใบที่อนุมัติแล้วเท่านั้นที่มีรายการบัญชี (PENDING ไม่เจอ = ไม่ต้องทำอะไร)
    await this.journalEntriesService?.reverseBySource(
      tenantId,
      JournalSourceTypeEnum.AP_PAYMENT,
      payment.id,
      voidedBy,
      `ยกเลิกใบสำคัญจ่าย ${payment.paymentNo}`,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.apPayment.update({
        where: { id },
        data: { status: 'VOID', voidedBy, voidedAt: new Date() },
      });

      // PENDING ยังไม่เคยตัดยอดใบแจ้งหนี้ → ไม่มีอะไรต้องคืน
      const allocationsToRestore = payment.status === 'APPROVED' ? payment.allocations : [];
      for (const alloc of allocationsToRestore) {
        const invoice = await tx.apInvoice.findFirst({ where: { id: alloc.invoiceId, tenantId } });
        if (!invoice) continue;

        const newPaid = Math.max(0, roundMoney(Number(invoice.paidAmount) - Number(alloc.amount)));
        const newBalance = roundMoney(Number(invoice.netPayable) - newPaid);
        const newStatus =
          invoice.status === 'VOID' ? 'VOID' : newPaid <= 0 ? 'APPROVED' : 'PARTIAL';

        await tx.apInvoice.update({
          where: { id: alloc.invoiceId },
          data: { paidAmount: newPaid, balance: newBalance, status: newStatus },
        });
      }
    });

    this.logger.log(`AP Payment ${payment.paymentNo} voided by ${voidedBy}`);
    return this.prisma.apPayment.findFirst({ where: { id, tenantId } });
  }
}
