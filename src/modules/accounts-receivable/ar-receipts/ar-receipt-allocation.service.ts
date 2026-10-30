import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { toBangkokDate, toBangkokMonth, bangkokMonthRange } from '@/common/utils/bangkok-day.util';
import { AllocateArReceiptDto } from './dto/allocate-ar-receipt.dto';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** JE ของการจัดสรรภายหลังใช้ sourceId = `<receiptId>:alloc:<เวลา>` ผูกกลับใบเสร็จเดิมได้ */
export const allocationSourcePrefix = (receiptId: string): string => `${receiptId}:alloc:`;

export interface ArReceiptSummary {
  month: string;
  receivedCount: number;
  receivedTotal: number;
  unallocatedTotal: number;
  unallocatedCount: number;
  outstandingTotal: number;
  overdueTotal: number;
  overdueCount: number;
}

/**
 * ฝั่ง "อ่าน + จัดสรรภายหลัง" ของใบเสร็จ — แยกจาก ArReceiptsService ที่ดูแลการสร้าง/ยกเลิก
 *
 * จัดสรรภายหลัง: เงินที่รับมาแล้วแต่ยังไม่ระบุใบ (ตอนรับลงเป็น 2105 เงินรับล่วงหน้า)
 * พอรู้ว่าจ่ายใบไหน → Dr 2105 / Cr 1103 หรือ 1104 ตามชนิดใบแจ้งหนี้
 */
@Injectable()
export class ArReceiptAllocationService {
  private readonly logger = new Logger(ArReceiptAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalEntries: JournalEntriesService,
  ) {}

  async findOne(id: string, tenantId: string) {
    const receipt = await this.prisma.arReceipt.findFirst({
      where: { id, tenantId },
      include: {
        guest: { select: { id: true, firstName: true, lastName: true } },
        allocations: {
          orderBy: { createdAt: 'asc' },
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNo: true,
                invoiceType: true,
                status: true,
                balance: true,
                totalAmount: true,
              },
            },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException(`Receipt ${id} not found`);

    const journals = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        OR: [
          { sourceType: 'AR_RECEIPT', sourceId: id },
          { sourceType: 'AR_RECEIPT', sourceId: { startsWith: allocationSourcePrefix(id) } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        entryNo: true,
        status: true,
        description: true,
        entryDate: true,
        lines: {
          orderBy: { lineNo: 'asc' },
          select: { debit: true, credit: true, account: { select: { code: true, name: true } } },
        },
      },
    });

    const allocated = round2(receipt.allocations.reduce((s, a) => s + Number(a.amount), 0));
    return {
      ...receipt,
      allocatedAmount: allocated,
      unallocatedAmount:
        receipt.status === 'VOID' ? 0 : round2(Number(receipt.totalAmount) - allocated),
      journals,
    };
  }

  async summary(tenantId: string, propertyId: string, month?: string): Promise<ArReceiptSummary> {
    if (!propertyId) throw new BadRequestException('propertyId is required');
    const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : toBangkokMonth(new Date());
    const { start, end } = bangkokMonthRange(ym);
    const today = new Date(`${toBangkokDate(new Date())}T00:00:00.000Z`);
    const monthStart = new Date(`${ym}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart.getTime() + (end.getTime() - start.getTime()));

    const [received, cleared, outstanding, overdue] = await Promise.all([
      this.prisma.arReceipt.aggregate({
        where: {
          tenantId,
          propertyId,
          status: 'CLEARED',
          receiptDate: { gte: monthStart, lt: monthEnd },
        },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.arReceipt.findMany({
        where: { tenantId, propertyId, status: 'CLEARED' },
        select: { totalAmount: true, allocations: { select: { amount: true } } },
      }),
      this.prisma.arInvoice.aggregate({
        where: {
          tenantId,
          propertyId,
          status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
          balance: { gt: 0 },
        },
        _sum: { balance: true },
      }),
      this.prisma.arInvoice.aggregate({
        where: {
          tenantId,
          propertyId,
          status: { in: ['ISSUED', 'PARTIAL', 'OVERDUE'] },
          balance: { gt: 0 },
          dueDate: { lt: today },
        },
        _count: { _all: true },
        _sum: { balance: true },
      }),
    ]);

    const unallocated = cleared
      .map((r) =>
        round2(Number(r.totalAmount) - r.allocations.reduce((s, a) => s + Number(a.amount), 0)),
      )
      .filter((v) => v > 0.005);

    return {
      month: ym,
      receivedCount: received._count._all,
      receivedTotal: round2(Number(received._sum.totalAmount ?? 0)),
      unallocatedTotal: round2(unallocated.reduce((s, v) => s + v, 0)),
      unallocatedCount: unallocated.length,
      outstandingTotal: round2(Number(outstanding._sum.balance ?? 0)),
      overdueTotal: round2(Number(overdue._sum.balance ?? 0)),
      overdueCount: overdue._count._all,
    };
  }

  async allocate(id: string, dto: AllocateArReceiptDto, tenantId: string, allocatedBy: string) {
    const receipt = await this.prisma.arReceipt.findFirst({
      where: { id, tenantId },
      include: { allocations: { select: { invoiceId: true, amount: true } } },
    });
    if (!receipt) throw new NotFoundException(`Receipt ${id} not found`);
    if (receipt.status !== 'CLEARED') {
      throw new BadRequestException(
        `จัดสรรได้เฉพาะใบเสร็จที่ผ่านรายการแล้ว (สถานะ ${receipt.status})`,
      );
    }

    const already = receipt.allocations.reduce((s, a) => s + Number(a.amount), 0);
    const available = round2(Number(receipt.totalAmount) - already);
    const requested = round2(dto.allocations.reduce((s, a) => s + a.amount, 0));
    if (requested <= 0) throw new BadRequestException('ยอดจัดสรรต้องมากกว่า 0');
    if (requested - available > 0.005) {
      throw new BadRequestException(
        `ยอดจัดสรร ${requested.toFixed(2)} เกินเงินที่ยังไม่ได้จัดสรร ${available.toFixed(2)}`,
      );
    }
    const ids = dto.allocations.map((a) => a.invoiceId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('ตัดชำระใบแจ้งหนี้ใบเดียวกันซ้ำในครั้งเดียวไม่ได้');
    }

    const invoices = await this.prisma.arInvoice.findMany({ where: { tenantId, id: { in: ids } } });
    const byId = new Map(invoices.map((i) => [i.id, i]));
    for (const a of dto.allocations) {
      const inv = byId.get(a.invoiceId);
      if (!inv) throw new NotFoundException(`Invoice ${a.invoiceId} not found`);
      if (inv.propertyId !== receipt.propertyId) {
        throw new BadRequestException(`${inv.invoiceNo} อยู่คนละสาขากับใบเสร็จ`);
      }
      if (['VOID', 'DRAFT', 'PAID'].includes(inv.status)) {
        throw new BadRequestException(`${inv.invoiceNo} สถานะ ${inv.status} ตัดชำระไม่ได้`);
      }
      if (a.amount - Number(inv.balance) > 0.005) {
        throw new BadRequestException(
          `ยอดตัดชำระเกินยอดคงค้างของ ${inv.invoiceNo} (${Number(inv.balance)})`,
        );
      }
    }

    const now = new Date();
    await assertPeriodOpen(this.prisma, tenantId, receipt.propertyId, now);
    const accountIds = await resolveAccountIds(this.prisma, tenantId, [
      ACCOUNT_CODES.DEPOSIT_RECEIVED,
      ACCOUNT_CODES.AR_TRADE,
      ACCOUNT_CODES.AR_CITY_LEDGER,
    ]);

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: string[] = [];
      for (const a of dto.allocations) {
        const inv = byId.get(a.invoiceId)!;
        const row = await tx.arReceiptAllocation.create({
          data: { tenantId, receiptId: receipt.id, invoiceId: a.invoiceId, amount: a.amount },
        });
        rows.push(row.id);
        const paid = round2(Number(inv.paidAmount) + a.amount);
        const balance = round2(Number(inv.totalAmount) - paid);
        await tx.arInvoice.update({
          where: { id: inv.id },
          data: {
            paidAmount: paid,
            balance: Math.max(0, balance),
            status: balance <= 0.01 ? 'PAID' : 'PARTIAL',
          },
        });
      }
      return rows;
    });

    const byCode = new Map<string, number>();
    for (const a of dto.allocations) {
      const code =
        byId.get(a.invoiceId)!.invoiceType === 'CITY_LEDGER'
          ? ACCOUNT_CODES.AR_CITY_LEDGER
          : ACCOUNT_CODES.AR_TRADE;
      byCode.set(code, round2((byCode.get(code) ?? 0) + a.amount));
    }
    const description = `จัดสรรเงินรับล่วงหน้า ${receipt.receiptNo}`;
    try {
      const entry = await this.journalEntries.createAndPostAutoEntry(tenantId, {
        propertyId: receipt.propertyId,
        entryDate: now,
        description,
        reference: receipt.receiptNo,
        sourceType: JournalSourceTypeEnum.AR_RECEIPT,
        sourceId: `${allocationSourcePrefix(receipt.id)}${now.getTime()}`,
        createdBy: allocatedBy,
        lines: [
          {
            accountId: accountIds.get(ACCOUNT_CODES.DEPOSIT_RECEIVED)!,
            lineNo: 1,
            description,
            debit: requested,
            credit: 0,
          },
          ...[...byCode.entries()].map(([code, amount], i) => ({
            accountId: accountIds.get(code)!,
            lineNo: i + 2,
            description,
            debit: 0,
            credit: amount,
          })),
        ],
      });
      this.logger.log(`Receipt ${receipt.receiptNo} allocated ${requested} → ${entry.entryNo}`);
    } catch (error) {
      // ลงบัญชีไม่ผ่าน → ถอยการจัดสรรออก ห้ามมีการตัดยอดลูกหนี้ที่ไม่มีรายการบัญชีรองรับ
      await this.prisma.$transaction(async (tx) => {
        for (const a of dto.allocations) {
          const inv = byId.get(a.invoiceId)!;
          await tx.arInvoice.update({
            where: { id: inv.id },
            data: { paidAmount: inv.paidAmount, balance: inv.balance, status: inv.status },
          });
        }
        await tx.arReceiptAllocation.deleteMany({ where: { tenantId, id: { in: created } } });
      });
      throw error;
    }

    return this.findOne(receipt.id, tenantId);
  }

  /** ยกเลิกใบเสร็จ → กลับรายการ JE ของการจัดสรรภายหลังทุกครั้งด้วย */
  async reverseAllocationJournals(
    id: string,
    tenantId: string,
    reversedBy: string,
    receiptNo: string,
  ) {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        sourceType: 'AR_RECEIPT',
        sourceId: { startsWith: allocationSourcePrefix(id) },
        status: 'POSTED',
      },
      select: { id: true },
    });
    for (const e of entries) {
      await this.journalEntries.reverse(
        e.id,
        tenantId,
        reversedBy,
        `ยกเลิกใบเสร็จ ${receiptNo} (การจัดสรร)`,
      );
    }
  }
}
