import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateArReceiptDto } from './dto/create-ar-receipt.dto';
import { ArReceiptAllocationService } from './ar-receipt-allocation.service';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
  settlementAccountCode,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { settleInvoice } from '../ar-invoice-balance.util';
import { RecordWhtCertificateDto } from './dto/record-wht-certificate.dto';

const roundMoney = (n: number): number => Math.round(n * 100) / 100;

interface ReceiptQuery {
  propertyId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ArReceiptsService {
  private readonly logger = new Logger(ArReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journalEntriesService?: JournalEntriesService,
    @Optional() private readonly allocationService?: ArReceiptAllocationService,
  ) {}

  private async generateReceiptNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'RCV', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'RCV', prefix: 'RCV', yearMonth, lastNumber: 1 },
    });
    return `RCV-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(tenantId: string, query: ReceiptQuery) {
    const { page = 1, limit = 20, propertyId, dateFrom, dateTo, status, search } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    const term = search?.trim();
    if (term) {
      where.OR = [
        { receiptNo: { contains: term } },
        { companyName: { contains: term } },
        { reference: { contains: term } },
        { guest: { firstName: { contains: term } } },
        { guest: { lastName: { contains: term } } },
      ];
    }
    if (dateFrom || dateTo) {
      where.receiptDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, data] = await Promise.all([
      this.prisma.arReceipt.count({ where }),
      this.prisma.arReceipt.findMany({
        where,
        include: {
          guest: { select: { id: true, firstName: true, lastName: true } },
          allocations: {
            include: { invoice: { select: { invoiceNo: true, totalAmount: true, balance: true } } },
          },
        },
        orderBy: [{ receiptDate: 'desc' }, { receiptNo: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    // เลข JE หลักของแต่ละใบ + ยอดที่ยังไม่ได้จัดสรร ให้ตารางแสดงได้โดยไม่ต้องเปิดทีละใบ
    const entries = data.length
      ? await this.prisma.journalEntry.findMany({
          where: { tenantId, sourceType: 'AR_RECEIPT', sourceId: { in: data.map((r) => r.id) } },
          select: { sourceId: true, entryNo: true, status: true },
        })
      : [];
    const entryOf = new Map(entries.map((e) => [e.sourceId, e]));
    const rows = data.map((r) => {
      const allocated = roundMoney(r.allocations.reduce((s, a) => s + Number(a.amount), 0));
      return {
        ...r,
        allocatedAmount: allocated,
        unallocatedAmount:
          r.status === 'VOID'
            ? 0
            : roundMoney(Number(r.totalAmount) + Number(r.whtAmount) - allocated),
        journalEntryNo: entryOf.get(r.id)?.entryNo ?? null,
      };
    });

    return { data: rows, total, page, limit };
  }

  async create(dto: CreateArReceiptDto, tenantId: string, createdBy: string) {
    const allocatedTotal = roundMoney(
      (dto.allocations ?? []).reduce((sum, a) => sum + a.amount, 0),
    );
    const invoiceIds = (dto.allocations ?? []).map((a) => a.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      throw new BadRequestException('ตัดชำระใบแจ้งหนี้ใบเดียวกันซ้ำในใบเสร็จเดียวไม่ได้');
    }
    // ลูกค้าหักภาษี ณ ที่จ่าย → เงินเข้าน้อยกว่ายอดหนี้ที่ตัดได้ (ตัดได้ = รับจริง + ภาษีถูกหัก)
    const whtAmount = roundMoney(dto.whtAmount ?? 0);
    if (whtAmount > 0 && whtAmount >= dto.totalAmount) {
      throw new BadRequestException('ภาษีหัก ณ ที่จ่ายต้องน้อยกว่ายอดเงินที่รับจริง');
    }
    if (allocatedTotal - (dto.totalAmount + whtAmount) > 0.01) {
      throw new BadRequestException(
        `ยอดตัดชำระรวม ${allocatedTotal} เกินยอดรับ ${dto.totalAmount}` +
          (whtAmount > 0 ? ` + ภาษีถูกหัก ${whtAmount}` : ''),
      );
    }

    // ตรวจก่อนบันทึกใบเสร็จ — งวดปิด/ผังบัญชีไม่ครบต้องล้มก่อน ไม่ใช่ได้ใบเสร็จที่ไม่มีรายการบัญชี
    const receiptDate = new Date(dto.receiptDate);
    await assertPeriodOpen(this.prisma, tenantId, dto.propertyId, receiptDate);
    const accountIds = await resolveAccountIds(this.prisma, tenantId, [
      settlementAccountCode(dto.method),
      ACCOUNT_CODES.AR_TRADE,
      ACCOUNT_CODES.AR_CITY_LEDGER,
      ACCOUNT_CODES.DEPOSIT_RECEIVED,
      ...(whtAmount > 0 ? [ACCOUNT_CODES.WHT_RECEIVABLE] : []),
    ]);

    const receiptNo = await this.generateReceiptNo(tenantId);

    const receipt = await this.prisma.$transaction(async (tx) => {
      const newReceipt = await tx.arReceipt.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          receiptNo,
          receiptDate,
          guestId: dto.guestId,
          companyName: dto.companyName,
          method: dto.method,
          totalAmount: dto.totalAmount,
          whtAmount,
          whtCertNo: whtAmount > 0 ? dto.whtCertNo || null : null,
          whtCertDate: whtAmount > 0 && dto.whtCertDate ? new Date(dto.whtCertDate) : null,
          reference: dto.reference,
          notes: dto.notes,
          status: 'CLEARED',
          createdBy,
        },
      });

      if (dto.allocations && dto.allocations.length > 0) {
        for (const alloc of dto.allocations) {
          const invoice = await tx.arInvoice.findFirst({
            where: { id: alloc.invoiceId, tenantId },
          });
          if (!invoice) {
            throw new NotFoundException(`Invoice ${alloc.invoiceId} not found`);
          }
          if (['VOID', 'DRAFT', 'PAID'].includes(invoice.status)) {
            throw new BadRequestException(
              `Cannot allocate to invoice ${invoice.invoiceNo} with status: ${invoice.status}`,
            );
          }
          if (alloc.amount - Number(invoice.balance) > 0.005) {
            throw new BadRequestException(
              `ยอดตัดชำระ ${alloc.amount} เกินยอดคงค้างของ ${invoice.invoiceNo} (${Number(invoice.balance)})`,
            );
          }

          await tx.arReceiptAllocation.create({
            data: {
              tenantId,
              receiptId: newReceipt.id,
              invoiceId: alloc.invoiceId,
              amount: alloc.amount,
            },
          });

          const settled = settleInvoice(invoice, { paid: alloc.amount });
          await tx.arInvoice.update({
            where: { id: alloc.invoiceId },
            data: { paidAmount: settled.paidAmount, balance: settled.balance, status: settled.status },
          });
        }
      }

      return newReceipt;
    });

    try {
      await this.postReceiptJournal(receipt.id, tenantId, createdBy, accountIds);
    } catch (error) {
      // ลงบัญชีไม่ผ่าน → ห้ามทิ้งใบเสร็จที่ตัดยอดลูกหนี้ไปแล้วแต่ไม่มีรายการบัญชี
      await this.discardUnpostedReceipt(receipt.id, tenantId);
      throw error;
    }

    this.logger.log(`Created AR Receipt ${receiptNo} for tenant ${tenantId}`);
    return this.prisma.arReceipt.findFirstOrThrow({ where: { id: receipt.id, tenantId } });
  }

  /** คืนยอดใบแจ้งหนี้ที่ตัดไป แล้วลบใบเสร็จที่ลงบัญชีไม่สำเร็จ */
  private async discardUnpostedReceipt(receiptId: string, tenantId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const allocations = await tx.arReceiptAllocation.findMany({ where: { receiptId, tenantId } });
      for (const alloc of allocations) {
        const invoice = await tx.arInvoice.findFirst({ where: { id: alloc.invoiceId, tenantId } });
        if (!invoice) continue;
        const settled = settleInvoice(invoice, { paid: -Number(alloc.amount) });
        await tx.arInvoice.update({
          where: { id: invoice.id },
          data: { paidAmount: settled.paidAmount, balance: settled.balance, status: settled.status },
        });
      }
      await tx.arReceiptAllocation.deleteMany({ where: { receiptId, tenantId } });
      await tx.arReceipt.deleteMany({ where: { id: receiptId, tenantId } });
    });
    this.logger.warn(`AR Receipt ${receiptId} discarded: journal posting failed`);
  }

  /**
   * DR เงินสด/ธนาคาร (ตามวิธีชำระ) = ยอดรับ
   * DR ภาษีถูกหัก ณ ที่จ่าย 1109 = ภาษีที่ลูกค้าหักไว้ (ถ้ามี)
   * CR ลูกหนี้การค้า 1103 / City Ledger 1104 = ยอดที่ตัดใบแจ้งหนี้ (ตามชนิดใบ)
   * CR เงินมัดจำรับล่วงหน้า 2105 = (ยอดรับ + ภาษีถูกหัก) ส่วนที่ยังไม่ได้ตัดใบไหน
   */
  private async postReceiptJournal(
    receiptId: string,
    tenantId: string,
    createdBy: string,
    accountIds: Map<string, string>,
  ): Promise<void> {
    if (!this.journalEntriesService) return;

    const receipt = await this.prisma.arReceipt.findFirstOrThrow({
      where: { id: receiptId, tenantId },
      include: { allocations: { include: { invoice: { select: { invoiceType: true } } } } },
    });

    const total = Number(receipt.totalAmount);
    const wht = Number(receipt.whtAmount);
    const byCode = new Map<string, number>();
    for (const alloc of receipt.allocations) {
      const code =
        alloc.invoice.invoiceType === 'CITY_LEDGER'
          ? ACCOUNT_CODES.AR_CITY_LEDGER
          : ACCOUNT_CODES.AR_TRADE;
      byCode.set(code, (byCode.get(code) ?? 0) + Number(alloc.amount));
    }
    const allocated = [...byCode.values()].reduce((sum, v) => sum + v, 0);
    const unallocated = roundMoney(total + wht - allocated);
    if (unallocated > 0) byCode.set(ACCOUNT_CODES.DEPOSIT_RECEIVED, unallocated);

    const description = `รับชำระ ${receipt.receiptNo}`;
    const debitLines = [
      {
        accountId: accountIds.get(settlementAccountCode(receipt.method))!,
        description,
        debit: total,
        credit: 0,
        subRef: receipt.receiptNo,
      },
      ...(wht > 0
        ? [
            {
              accountId: accountIds.get(ACCOUNT_CODES.WHT_RECEIVABLE)!,
              description: `ภาษีถูกหัก ณ ที่จ่าย ${receipt.receiptNo}`,
              debit: wht,
              credit: 0,
              subRef: receipt.receiptNo,
            },
          ]
        : []),
    ];
    const creditLines = [...byCode.entries()].map(([code, amount], i) => ({
      accountId: accountIds.get(code)!,
      lineNo: i + 1 + debitLines.length,
      description,
      debit: 0,
      credit: amount,
      subRef: receipt.receiptNo,
    }));

    await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
      propertyId: receipt.propertyId,
      entryDate: receipt.receiptDate,
      description,
      reference: receipt.receiptNo,
      sourceType: JournalSourceTypeEnum.AR_RECEIPT,
      sourceId: receipt.id,
      createdBy,
      lines: [...debitLines.map((l, i) => ({ ...l, lineNo: i + 1 })), ...creditLines],
    });

    await this.prisma.arReceipt.updateMany({
      where: { id: receipt.id, tenantId },
      data: { isPosted: true, postedAt: new Date() },
    });
  }

  async void(id: string, tenantId: string, voidedBy: string) {
    const receipt = await this.prisma.arReceipt.findFirst({
      where: { id, tenantId },
      include: { allocations: true },
    });
    if (!receipt) throw new NotFoundException(`Receipt ${id} not found`);
    if (receipt.status === 'VOID') {
      throw new BadRequestException('Receipt is already void');
    }

    await this.journalEntriesService?.reverseBySource(
      tenantId,
      JournalSourceTypeEnum.AR_RECEIPT,
      receipt.id,
      voidedBy,
      `ยกเลิกใบเสร็จ ${receipt.receiptNo}`,
    );
    await this.allocationService?.reverseAllocationJournals(
      receipt.id,
      tenantId,
      voidedBy,
      receipt.receiptNo,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.arReceipt.update({
        where: { id },
        data: { status: 'VOID', voidedBy, voidedAt: new Date() },
      });

      for (const alloc of receipt.allocations) {
        const invoice = await tx.arInvoice.findFirst({
          where: { id: alloc.invoiceId, tenantId },
        });
        if (!invoice) continue;

        const settled = settleInvoice(invoice, { paid: -Number(alloc.amount) });
        await tx.arInvoice.update({
          where: { id: alloc.invoiceId },
          data: { paidAmount: settled.paidAmount, balance: settled.balance, status: settled.status },
        });
      }
    });

    this.logger.log(`AR Receipt ${receipt.receiptNo} voided by ${voidedBy}`);
    return this.prisma.arReceipt.findFirst({ where: { id, tenantId } });
  }

  /** บันทึก/แก้ไขเลขหนังสือรับรอง 50 ทวิ ที่ลูกค้าส่งมาทีหลัง (ไม่กระทบรายการบัญชี) */
  async recordWhtCertificate(id: string, dto: RecordWhtCertificateDto, tenantId: string) {
    const receipt = await this.prisma.arReceipt.findFirst({ where: { id, tenantId } });
    if (!receipt) throw new NotFoundException(`Receipt ${id} not found`);
    if (receipt.status === 'VOID') throw new BadRequestException('ใบเสร็จถูกยกเลิกแล้ว');
    if (Number(receipt.whtAmount) <= 0) {
      throw new BadRequestException('ใบเสร็จนี้ไม่มีภาษีหัก ณ ที่จ่าย');
    }
    await this.prisma.arReceipt.updateMany({
      where: { id, tenantId },
      data: {
        whtCertNo: dto.whtCertNo.trim(),
        whtCertDate: dto.whtCertDate ? new Date(dto.whtCertDate) : null,
      },
    });
    this.logger.log(`AR Receipt ${receipt.receiptNo} WHT certificate ${dto.whtCertNo} recorded`);
    return this.prisma.arReceipt.findFirstOrThrow({ where: { id, tenantId } });
  }
}
