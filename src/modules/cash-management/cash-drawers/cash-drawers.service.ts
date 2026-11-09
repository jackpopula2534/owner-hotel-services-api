import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCashDrawerDto } from './dto/create-cash-drawer.dto';
import { CreateCashTxnDto, CashTxnType } from './dto/create-cash-txn.dto';
import { CloseCashDrawerDto } from './dto/close-cash-drawer.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { ensureCashOverShortAccount } from '@/modules/accounting/ledger/folio-gl.util';

/** cash txn ที่มาจากโมดูลอื่นซึ่งลงบัญชีเองแล้ว — ห้ามลง JE ซ้ำจากฝั่งลิ้นชัก */
export const CASH_SOURCE_FOLIO_PAYMENT = 'FOLIO_PAYMENT';
const SELF_POSTED_SOURCES = new Set([CASH_SOURCE_FOLIO_PAYMENT, 'TRANSFER']);

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface FolioCashReceiptInput {
  tenantId: string;
  propertyId: string;
  drawerId?: string;
  amount: number;
  description: string;
  folioPaymentId: string;
  reference?: string;
  createdBy: string;
}

interface TxnQuery {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class CashDrawersService {
  private readonly logger = new Logger(CashDrawersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalEntries: JournalEntriesService,
  ) {}

  async findAll(tenantId: string, propertyId?: string, status?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;

    const data = await this.prisma.cashDrawer.findMany({
      where,
      orderBy: [{ propertyId: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        tenantId: true,
        propertyId: true,
        name: true,
        code: true,
        openingBalance: true,
        currentBalance: true,
        status: true,
        openedBy: true,
        openedAt: true,
        closedBy: true,
        closedAt: true,
        countedAmount: true,
        variance: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { data, total: data.length };
  }

  async findOne(id: string, tenantId: string) {
    const drawer = await this.prisma.cashDrawer.findFirst({
      where: { id, tenantId },
    });
    if (!drawer) throw new NotFoundException(`Cash drawer ${id} not found`);
    return drawer;
  }

  async create(dto: CreateCashDrawerDto, tenantId: string) {
    const existing = await this.prisma.cashDrawer.findFirst({
      where: { tenantId, propertyId: dto.propertyId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Cash drawer with code "${dto.code}" already exists in this property`,
      );
    }

    const openingBalance = dto.openingBalance ?? 0;
    const drawer = await this.prisma.cashDrawer.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        name: dto.name,
        code: dto.code,
        openingBalance,
        currentBalance: openingBalance,
        status: 'CLOSED',
      },
    });

    this.logger.log(`Cash drawer created: ${drawer.id} (${drawer.code})`);
    return drawer;
  }

  async open(id: string, tenantId: string, openedBy: string) {
    const drawer = await this.findOne(id, tenantId);

    if (drawer.status === 'OPEN') {
      throw new BadRequestException('Cash drawer is already open');
    }
    if (drawer.status === 'PENDING') {
      throw new BadRequestException(
        'กะก่อนหน้ายังรอหัวหน้าอนุมัติปิดกะ — อนุมัติก่อนจึงเปิดกะใหม่ได้',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const d = await tx.cashDrawer.update({
        where: { id },
        data: {
          status: 'OPEN',
          openedBy,
          openedAt: new Date(),
          closedBy: null,
          closedAt: null,
          countedAmount: null,
          variance: null,
        },
      });

      // Create OPENING transaction
      await tx.cashTransaction.create({
        data: {
          drawerId: id,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: 'OPENING',
          description: 'เปิดลิ้นชักเงินสด',
          amount: Number(drawer.openingBalance),
          balance: Number(drawer.openingBalance),
          createdBy: openedBy,
        },
      });

      return d;
    });

    this.logger.log(`Cash drawer ${id} opened by ${openedBy}`);
    return updated;
  }

  /**
   * ปิดกะ (blind count) → PENDING รอหัวหน้ากะอนุมัติ ยังไม่ลงบัญชีผลต่างจนกว่าจะอนุมัติ
   * ยอดไม่ตรงต้องมีหมายเหตุเสมอ
   */
  async close(id: string, tenantId: string, closedBy: string, dto: CloseCashDrawerDto) {
    const drawer = await this.findOne(id, tenantId);

    if (drawer.status !== 'OPEN') {
      throw new BadRequestException(`Cash drawer is not open (status: ${drawer.status})`);
    }

    const countedAmount = round2(dto.countedAmount);
    const variance = round2(countedAmount - Number(drawer.currentBalance));
    if (variance !== 0 && !dto.notes?.trim()) {
      throw new BadRequestException('ยอดนับไม่ตรงระบบ — กรุณาระบุหมายเหตุสาเหตุของผลต่าง');
    }
    const notes = [
      dto.notes?.trim(),
      dto.denominations?.trim() ? `นับเงิน: ${dto.denominations.trim()}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.cashTransaction.create({
        data: {
          drawerId: id,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: 'CLOSING',
          description: `ปิดกะ — นับได้ ${countedAmount.toFixed(2)} (ผลต่าง ${variance.toFixed(2)})`,
          amount: Number(drawer.currentBalance),
          balance: Number(drawer.currentBalance),
          createdBy: closedBy,
        },
      });

      return tx.cashDrawer.update({
        where: { id },
        data: {
          status: 'PENDING',
          closedBy,
          closedAt: new Date(),
          countedAmount,
          variance,
          notes: notes || null,
        },
      });
    });

    this.logger.log(
      `Cash drawer ${id} closed by ${closedBy}, variance: ${variance} — pending approval`,
    );
    return updated;
  }

  /**
   * หัวหน้ากะอนุมัติปิดกะ → CLOSED และลงบัญชีผลต่างเงินสด
   *   ขาด: Dr 6310 เงินสดขาด/เกิน / Cr 1101 เงินสด
   *   เกิน: Dr 1101 / Cr 6310
   * มีผลต่าง → คนปิดกะอนุมัติเองไม่ได้
   */
  async approveClose(id: string, tenantId: string, approvedBy: string) {
    const drawer = await this.findOne(id, tenantId);
    if (drawer.status !== 'PENDING') {
      throw new BadRequestException(`ลิ้นชักไม่ได้อยู่ในสถานะรออนุมัติ (status: ${drawer.status})`);
    }
    const variance = round2(Number(drawer.variance ?? 0));
    const counted = round2(Number(drawer.countedAmount ?? drawer.currentBalance));
    if (variance !== 0 && drawer.closedBy === approvedBy) {
      throw new ForbiddenException('ยอดเงินมีผลต่าง — ต้องให้ผู้อื่น (หัวหน้ากะ) เป็นผู้อนุมัติ');
    }

    let accountIds: Map<string, string> | null = null;
    if (variance !== 0) {
      await assertPeriodOpen(this.prisma, tenantId, drawer.propertyId, new Date());
      await ensureCashOverShortAccount(this.prisma, tenantId);
      accountIds = await resolveAccountIds(this.prisma, tenantId, [
        ACCOUNT_CODES.CASH,
        ACCOUNT_CODES.CASH_OVER_SHORT,
      ]);
    }

    const { drawer: updated, txn } = await this.prisma.$transaction(async (tx) => {
      const adj =
        variance !== 0
          ? await tx.cashTransaction.create({
              data: {
                drawerId: id,
                tenantId,
                propertyId: drawer.propertyId,
                txnType: 'ADJUSTMENT',
                description: variance < 0 ? 'ปรับปรุงเงินสดขาดบัญชี' : 'ปรับปรุงเงินสดเกินบัญชี',
                amount: variance,
                balance: counted,
                sourceType: 'CASH_OVER_SHORT',
                sourceId: id,
                createdBy: approvedBy,
              },
            })
          : null;
      const d = await tx.cashDrawer.update({
        where: { id },
        data: { status: 'CLOSED', currentBalance: counted },
      });
      return { drawer: d, txn: adj };
    });

    let journalEntryNo: string | null = null;
    if (txn && accountIds) {
      const amount = Math.abs(variance);
      const cashId = accountIds.get(ACCOUNT_CODES.CASH) as string;
      const overShortId = accountIds.get(ACCOUNT_CODES.CASH_OVER_SHORT) as string;
      const description = `${drawer.code} เงินสด${variance < 0 ? 'ขาด' : 'เกิน'}บัญชี`;
      try {
        const entry = await this.journalEntries.createAndPostAutoEntry(tenantId, {
          propertyId: drawer.propertyId,
          entryDate: new Date(),
          description,
          reference: drawer.code,
          sourceType: JournalSourceTypeEnum.ADJUSTMENT,
          sourceId: txn.id,
          createdBy: approvedBy,
          lines: [
            {
              accountId: variance < 0 ? overShortId : cashId,
              lineNo: 1,
              description,
              debit: amount,
              credit: 0,
            },
            {
              accountId: variance < 0 ? cashId : overShortId,
              lineNo: 2,
              description,
              debit: 0,
              credit: amount,
            },
          ],
        });
        journalEntryNo = entry.entryNo;
      } catch (error) {
        this.logger.error(
          `Cash over/short journal failed for drawer ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    this.logger.log(`Cash drawer ${id} close approved by ${approvedBy} (variance ${variance})`);
    return { ...updated, journalEntryNo };
  }

  /**
   * รับเงินสดจากการชำระ folio เข้าลิ้นชักภายใน transaction เดียวกับการชำระ
   * - ระบุ drawerId ได้ ไม่ระบุ → ใช้ลิ้นชักที่เปิดอยู่ลิ้นชักเดียวของ property
   * - property ที่ไม่ได้ใช้ลิ้นชักเลย → คืน null (ไม่บังคับ)
   * JE ของเงินก้อนนี้ลงจากฝั่ง folio แล้ว (Dr 1101 / Cr 1103) ฝั่งลิ้นชักจึงไม่ลงซ้ำ
   */
  async recordFolioCashReceiptWithin(tx: Prisma.TransactionClient, input: FolioCashReceiptInput) {
    const drawers = await tx.cashDrawer.findMany({
      where: {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        ...(input.drawerId ? { id: input.drawerId } : {}),
      },
      select: { id: true, code: true, status: true, currentBalance: true },
    });
    if (drawers.length === 0) {
      if (input.drawerId) throw new NotFoundException(`Cash drawer ${input.drawerId} not found`);
      return null;
    }
    const open = drawers.filter((d) => d.status === 'OPEN');
    if (open.length === 0) {
      throw new BadRequestException('ไม่มีลิ้นชักเงินสดที่เปิดกะอยู่ — เปิดกะก่อนรับเงินสด');
    }
    if (open.length > 1) {
      throw new BadRequestException('มีลิ้นชักเปิดอยู่หลายลิ้นชัก — กรุณาเลือกลิ้นชักที่รับเงิน');
    }
    const drawer = open[0];
    const balance = round2(Number(drawer.currentBalance) + input.amount);
    const txn = await tx.cashTransaction.create({
      data: {
        drawerId: drawer.id,
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        txnType: 'RECEIPT',
        description: input.description,
        amount: input.amount,
        balance,
        sourceType: CASH_SOURCE_FOLIO_PAYMENT,
        sourceId: input.folioPaymentId,
        reference: input.reference ?? null,
        createdBy: input.createdBy,
      },
    });
    await tx.cashDrawer.update({ where: { id: drawer.id }, data: { currentBalance: balance } });
    return { txn, drawerCode: drawer.code };
  }

  async addTransaction(dto: CreateCashTxnDto, tenantId: string, createdBy: string) {
    const drawer = await this.findOne(dto.drawerId, tenantId);

    if (drawer.status !== 'OPEN') {
      throw new BadRequestException('Cash drawer must be OPEN to add transactions');
    }

    // RECEIPT/PAYMENT ที่คีย์จากหน้าลิ้นชักต้องลงบัญชีคู่ — ตรวจบัญชี/งวดก่อนขยับเงิน
    const glPlan = this.cashGlPlan(dto);
    let glAccounts: Map<string, string> | null = null;
    if (glPlan) {
      await assertPeriodOpen(this.prisma, tenantId, drawer.propertyId, new Date());
      glAccounts = await resolveAccountIds(this.prisma, tenantId, [glPlan.debit, glPlan.credit]);
    }

    // For TRANSFER: validate destination drawer
    let destDrawer = null;
    if (dto.txnType === CashTxnType.TRANSFER) {
      if (!dto.toDrawerId) {
        throw new BadRequestException('toDrawerId is required for TRANSFER transactions');
      }
      destDrawer = await this.findOne(dto.toDrawerId, tenantId);
      if (destDrawer.status !== 'OPEN') {
        throw new BadRequestException('Destination cash drawer must be OPEN');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Determine balance impact
      let newSourceBalance = Number(drawer.currentBalance);

      if (dto.txnType === CashTxnType.RECEIPT || dto.txnType === CashTxnType.OPENING) {
        newSourceBalance += dto.amount;
      } else if (
        dto.txnType === CashTxnType.PAYMENT ||
        dto.txnType === CashTxnType.CLOSING ||
        dto.txnType === CashTxnType.TRANSFER
      ) {
        if (newSourceBalance < dto.amount) {
          throw new BadRequestException('Insufficient balance in cash drawer');
        }
        newSourceBalance -= dto.amount;
      } else if (dto.txnType === CashTxnType.ADJUSTMENT) {
        newSourceBalance += dto.amount; // can be negative via signed amount from outside
      }

      // Create source transaction
      const txn = await tx.cashTransaction.create({
        data: {
          drawerId: dto.drawerId,
          tenantId,
          propertyId: drawer.propertyId,
          txnType: dto.txnType,
          description: dto.description,
          amount: dto.amount,
          balance: newSourceBalance,
          toDrawerId: dto.toDrawerId ?? null,
          sourceType: dto.sourceType ?? null,
          sourceId: dto.sourceId ?? null,
          reference: dto.reference ?? null,
          createdBy,
        },
      });

      // Update source drawer balance
      await tx.cashDrawer.update({
        where: { id: dto.drawerId },
        data: { currentBalance: newSourceBalance },
      });

      // For TRANSFER: credit destination drawer
      if (dto.txnType === CashTxnType.TRANSFER && destDrawer) {
        const newDestBalance = Number(destDrawer.currentBalance) + dto.amount;

        await tx.cashTransaction.create({
          data: {
            drawerId: dto.toDrawerId!,
            tenantId,
            propertyId: destDrawer.propertyId,
            txnType: 'RECEIPT',
            description: `รับโอนจาก ${drawer.code}: ${dto.description}`,
            amount: dto.amount,
            balance: newDestBalance,
            sourceType: 'TRANSFER',
            sourceId: dto.drawerId,
            reference: dto.reference ?? null,
            createdBy,
          },
        });

        await tx.cashDrawer.update({
          where: { id: dto.toDrawerId! },
          data: { currentBalance: newDestBalance },
        });
      }

      return txn;
    });

    let journalEntryNo: string | null = null;
    if (glPlan && glAccounts) {
      const description = `${drawer.code}: ${dto.description}`;
      try {
        const entry = await this.journalEntries.createAndPostAutoEntry(tenantId, {
          propertyId: drawer.propertyId,
          entryDate: new Date(),
          description,
          reference: dto.reference ?? drawer.code,
          sourceType: JournalSourceTypeEnum.ADJUSTMENT,
          sourceId: result.id,
          createdBy,
          lines: [
            {
              accountId: glAccounts.get(glPlan.debit) as string,
              lineNo: 1,
              description,
              debit: dto.amount,
              credit: 0,
            },
            {
              accountId: glAccounts.get(glPlan.credit) as string,
              lineNo: 2,
              description,
              debit: 0,
              credit: dto.amount,
            },
          ],
        });
        journalEntryNo = entry.entryNo;
      } catch (error) {
        this.logger.error(
          `Cash journal failed for txn ${result.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    this.logger.log(
      `Cash transaction created: ${result.id} type=${dto.txnType} amount=${dto.amount}`,
    );
    return { ...result, journalEntryNo };
  }

  /** บัญชีคู่ของรายการเงินสดที่คีย์จากลิ้นชัก — null = ไม่ต้องลงบัญชี (ย้ายเงินภายใน/ลงจากต้นทางแล้ว) */
  private cashGlPlan(dto: CreateCashTxnDto): { debit: string; credit: string } | null {
    if (dto.sourceType && SELF_POSTED_SOURCES.has(dto.sourceType)) return null;
    if (dto.txnType === CashTxnType.RECEIPT) {
      return { debit: ACCOUNT_CODES.CASH, credit: dto.accountCode ?? ACCOUNT_CODES.OTHER_REVENUE };
    }
    if (dto.txnType === CashTxnType.PAYMENT) {
      return { debit: dto.accountCode ?? ACCOUNT_CODES.OTHER_EXPENSE, credit: ACCOUNT_CODES.CASH };
    }
    return null;
  }

  async getTransactions(drawerId: string, tenantId: string, query: TxnQuery) {
    const { dateFrom, dateTo, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    // Validate drawer belongs to tenant
    await this.findOne(drawerId, tenantId);

    const where: Record<string, unknown> = { drawerId, tenantId };
    if (dateFrom || dateTo) {
      where.txnDate = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }

    const [total, rows] = await Promise.all([
      this.prisma.cashTransaction.count({ where }),
      this.prisma.cashTransaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    // เลข JE ของแต่ละรายการ — ลงจากลิ้นชักเอง (sourceId = txn.id) หรือจาก folio (sourceId = payment id)
    const keys = [
      ...rows.map((r) => r.id),
      ...rows
        .filter((r) => r.sourceType === CASH_SOURCE_FOLIO_PAYMENT && r.sourceId)
        .map((r) => r.sourceId as string),
    ];
    const entries = keys.length
      ? await this.prisma.journalEntry.findMany({
          where: { tenantId, sourceId: { in: keys }, status: { in: ['POSTED', 'DRAFT'] } },
          select: { sourceId: true, entryNo: true },
        })
      : [];
    const entryOf = new Map(entries.map((e) => [e.sourceId, e.entryNo]));
    const data = rows.map((r) => ({
      ...r,
      journalEntryNo:
        entryOf.get(r.id) ??
        (r.sourceType === CASH_SOURCE_FOLIO_PAYMENT && r.sourceId
          ? entryOf.get(r.sourceId)
          : undefined) ??
        null,
    }));

    return { data, total, page, limit };
  }
}
