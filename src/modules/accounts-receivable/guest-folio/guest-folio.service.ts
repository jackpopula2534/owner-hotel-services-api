import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { FolioStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateFolioChargeDto } from './dto/create-folio-charge.dto';
import { AccPaymentMethod, CreateFolioPaymentDto } from './dto/create-folio-payment.dto';
import { TransferCityLedgerDto } from './dto/transfer-city-ledger.dto';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import { assertPeriodOpen } from '@/modules/accounting/ledger/journal-posting.util';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
  settlementAccountCode,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { buildGuestLedgerLines } from '@/modules/accounting/ledger/folio-gl.util';
import { CashDrawersService } from '@/modules/cash-management/cash-drawers/cash-drawers.service';

/** วิธีชำระที่ไม่ใช่การรับเงิน — ไม่ลง JE อัตโนมัติ (ใบลดหนี้ต้องออกผ่านโมดูล AR) */
const NON_CASH_SETTLEMENT = new Set<string>([AccPaymentMethod.CREDIT_NOTE]);

const round2 = (v: number): number => Math.round(v * 100) / 100;

@Injectable()
export class GuestFolioService {
  private readonly logger = new Logger(GuestFolioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journalEntries: JournalEntriesService,
    private readonly cashDrawers: CashDrawersService,
  ) {}

  private async generateFolioNo(tenantId: string): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'FOLIO', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'FOLIO', prefix: 'FOLIO', yearMonth, lastNumber: 1 },
    });
    return `FOLIO-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }

  async findAll(
    tenantId: string,
    query: {
      propertyId?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { propertyId, status, search } = query;
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const where: Prisma.GuestFolioWhereInput = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status as FolioStatus;
    const term = search?.trim();
    if (term) {
      where.OR = [
        { folioNo: { contains: term } },
        { booking: { bookingNo: { contains: term } } },
        { booking: { room: { number: { contains: term } } } },
        { guest: { firstName: { contains: term } } },
        { guest: { lastName: { contains: term } } },
      ];
    }

    const [total, data] = await Promise.all([
      this.prisma.guestFolio.count({ where }),
      this.prisma.guestFolio.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              bookingNo: true,
              checkIn: true,
              checkOut: true,
              room: { select: { id: true, number: true } },
            },
          },
          guest: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id, tenantId },
      include: {
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paymentDate: 'asc' } },
        booking: { select: { id: true, bookingNo: true } },
        guest: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!folio) throw new NotFoundException(`Folio ${id} not found`);

    // เลข JE ต่อบรรทัด: charge → JE ของ Night Audit ที่กวาดไป, payment → JE ที่ sourceId = payment.id
    const auditIds = [
      ...new Set(folio.charges.map((c) => c.nightAuditId).filter((v): v is string => Boolean(v))),
    ];
    const audits = auditIds.length
      ? await this.prisma.nightAudit.findMany({
          where: { id: { in: auditIds }, tenantId },
          select: { id: true, status: true, journalEntryId: true },
        })
      : [];
    const jeIds = audits.map((a) => a.journalEntryId).filter((v): v is string => Boolean(v));
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        OR: [
          ...(jeIds.length ? [{ id: { in: jeIds } }] : []),
          { sourceId: { in: folio.payments.map((p) => p.id) } },
        ],
      },
      select: { id: true, entryNo: true, status: true, sourceId: true },
    });
    const byId = new Map(entries.map((e) => [e.id, e]));
    const bySource = new Map(entries.map((e) => [e.sourceId, e]));
    const auditOf = new Map(audits.map((a) => [a.id, a]));

    return {
      ...folio,
      charges: folio.charges.map((c) => {
        const audit = c.nightAuditId ? auditOf.get(c.nightAuditId) : undefined;
        const je = audit?.journalEntryId ? byId.get(audit.journalEntryId) : undefined;
        return {
          ...c,
          auditStatus: audit?.status ?? null,
          journalEntryNo: je?.entryNo ?? null,
          journalStatus: je?.status ?? null,
        };
      }),
      payments: folio.payments.map((p) => {
        const je = bySource.get(p.id);
        return { ...p, journalEntryNo: je?.entryNo ?? null, journalStatus: je?.status ?? null };
      }),
    };
  }

  /** ตัวเลขหัวหน้า Guest Folio: จำนวน folio เปิด/รอชำระ และยอดค้าง Guest Ledger */
  async getSummary(tenantId: string, propertyId?: string) {
    const base: Prisma.GuestFolioWhereInput = { tenantId, ...(propertyId ? { propertyId } : {}) };
    const [open, pending] = await Promise.all([
      this.prisma.guestFolio.aggregate({
        where: { ...base, status: 'OPEN' },
        _count: { _all: true },
        _sum: { balance: true },
      }),
      this.prisma.guestFolio.aggregate({
        where: { ...base, status: 'PENDING' },
        _count: { _all: true },
        _sum: { balance: true },
      }),
    ]);
    return {
      openCount: open._count._all,
      openBalance: round2(Number(open._sum.balance ?? 0)),
      pendingCount: pending._count._all,
      pendingBalance: round2(Number(pending._sum.balance ?? 0)),
      guestLedgerBalance: round2(
        Number(open._sum.balance ?? 0) + Number(pending._sum.balance ?? 0),
      ),
    };
  }

  async findByBooking(bookingId: string, tenantId: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { bookingId, tenantId },
      include: {
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paymentDate: 'asc' } },
      },
    });
    if (!folio) throw new NotFoundException(`Folio for booking ${bookingId} not found`);
    return folio;
  }

  async createForBooking(
    bookingId: string,
    guestId: string,
    propertyId: string,
    tenantId: string,
    createdBy: string,
  ) {
    const existing = await this.prisma.guestFolio.findFirst({
      where: { bookingId, tenantId },
    });
    if (existing) {
      this.logger.warn(`Folio already exists for booking ${bookingId}`);
      return existing;
    }

    const folioNo = await this.generateFolioNo(tenantId);

    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId } });
    const checkInDate = booking?.checkIn ?? new Date();

    const folio = await this.prisma.guestFolio.create({
      data: {
        tenantId,
        propertyId,
        booking: { connect: { id: bookingId } },
        guest: { connect: { id: guestId } },
        folioNo,
        status: 'OPEN',
        checkInDate,
        openDate: new Date(),
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
        createdBy,
      },
    });

    this.logger.log(`Created folio ${folioNo} for booking ${bookingId}`);
    return folio;
  }

  async addCharge(dto: CreateFolioChargeDto, tenantId: string, postedBy: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: dto.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio ${dto.folioId} not found`);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot add charge to folio with status: ${folio.status}`);
    }

    const vatRate = dto.vatRate ?? 7;
    const netAmount = dto.quantity * dto.unitPrice;
    const vatAmount = netAmount * (vatRate / 100);
    const totalAmount = netAmount + vatAmount;
    const chargeDate = dto.chargeDate ? new Date(dto.chargeDate) : new Date();

    const charge = await this.prisma.$transaction(async (tx) => {
      const newCharge = await tx.folioCharge.create({
        data: {
          tenantId,
          propertyId: folio.propertyId,
          folio: { connect: { id: dto.folioId } },
          chargeDate,
          chargeType: dto.chargeType,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          netAmount,
          vatRate,
          vatAmount,
          totalAmount,
          accountId: dto.accountId,
          costCenterId: dto.costCenterId,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          postedBy,
          status: 'POSTED',
        },
      });

      await tx.guestFolio.update({
        where: { id: dto.folioId },
        data: {
          totalCharges: { increment: totalAmount },
          balance: { increment: totalAmount },
        },
      });

      return newCharge;
    });

    return charge;
  }

  /**
   * รับชำระ folio → ลดยอด Guest Ledger และลงบัญชีทันที
   *   Dr 1101 เงินสด | 1102 ธนาคาร | 2105 มัดจำ | 1104 City Ledger  /  Cr 1103 ลูกหนี้แขก
   * เงินสดเข้าลิ้นชักที่เปิดกะอยู่ใน transaction เดียวกัน (ลิ้นชักไม่ลง JE ซ้ำ)
   * รับได้ทั้ง folio OPEN และ PENDING (เช็คเอาต์แล้วแต่ยังค้างชำระ)
   */
  async addPayment(dto: CreateFolioPaymentDto, tenantId: string, postedBy: string) {
    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: dto.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio ${dto.folioId} not found`);
    if (folio.status !== 'OPEN' && folio.status !== 'PENDING') {
      throw new BadRequestException(`Cannot add payment to folio with status: ${folio.status}`);
    }

    const postsJournal = !NON_CASH_SETTLEMENT.has(dto.method);
    const debitCode = settlementAccountCode(dto.method);
    let accountIds: Map<string, string> | null = null;
    if (postsJournal) {
      await assertPeriodOpen(this.prisma, tenantId, folio.propertyId, new Date());
      accountIds = await resolveAccountIds(this.prisma, tenantId, [
        debitCode,
        ACCOUNT_CODES.AR_TRADE,
      ]);
    }

    const { payment, cash } = await this.prisma.$transaction(async (tx) => {
      const newPayment = await tx.folioPayment.create({
        data: {
          tenantId,
          propertyId: folio.propertyId,
          folio: { connect: { id: dto.folioId } },
          paymentDate: new Date(),
          method: dto.method,
          amount: dto.amount,
          reference: dto.reference,
          payerName: dto.payerName,
          notes: dto.notes,
          postedBy,
          status: 'CLEARED',
        },
      });

      const updatedFolio = await tx.guestFolio.update({
        where: { id: dto.folioId },
        data: {
          totalPayments: { increment: dto.amount },
          balance: { decrement: dto.amount },
        },
      });
      // เช็คเอาต์แล้วจ่ายครบ → ปิด folio ให้เลย
      if (folio.status === 'PENDING' && Number(updatedFolio.balance) <= 0.01) {
        await tx.guestFolio.update({
          where: { id: dto.folioId },
          data: { status: 'CLOSED', closedAt: new Date(), closedBy: postedBy },
        });
      }

      const cashReceipt =
        dto.method === AccPaymentMethod.CASH
          ? await this.cashDrawers.recordFolioCashReceiptWithin(tx, {
              tenantId,
              propertyId: folio.propertyId,
              drawerId: dto.drawerId,
              amount: dto.amount,
              description: `รับชำระ ${folio.folioNo}`,
              folioPaymentId: newPayment.id,
              reference: folio.folioNo,
              createdBy: postedBy,
            })
          : null;

      return { payment: newPayment, cash: cashReceipt };
    });

    let journalEntryNo: string | null = null;
    if (postsJournal && accountIds) {
      const description = `รับชำระ ${folio.folioNo} (${dto.method})`;
      try {
        const entry = await this.journalEntries.createAndPostAutoEntry(tenantId, {
          propertyId: folio.propertyId,
          entryDate: payment.paymentDate,
          description,
          reference: folio.folioNo,
          sourceType: JournalSourceTypeEnum.AR_RECEIPT,
          sourceId: payment.id,
          createdBy: postedBy,
          lines: [
            {
              accountId: accountIds.get(debitCode) as string,
              lineNo: 1,
              description,
              debit: dto.amount,
              credit: 0,
            },
            {
              accountId: accountIds.get(ACCOUNT_CODES.AR_TRADE) as string,
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
          `Folio payment journal failed for ${payment.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    return { ...payment, journalEntryNo, cashDrawerCode: cash?.drawerCode ?? null };
  }

  /**
   * โอนยอดคงค้างไปเรียกเก็บบริษัท (City Ledger) — Dr 1104 / Cr 1103 แล้ว folio ปิดได้
   * ไม่ออกใบแจ้งหนี้ AR อัตโนมัติ เพราะใบแจ้งหนี้จะรับรู้รายได้ซ้ำกับ Night Audit
   */
  async transferToCityLedger(
    id: string,
    dto: TransferCityLedgerDto,
    tenantId: string,
    postedBy: string,
  ) {
    const folio = await this.prisma.guestFolio.findFirst({ where: { id, tenantId } });
    if (!folio) throw new NotFoundException(`Folio ${id} not found`);
    const balance = round2(Number(folio.balance));
    if (balance <= 0) throw new BadRequestException('Folio ไม่มียอดค้างให้โอน');
    const amount = round2(dto.amount ?? balance);
    if (amount - balance > 0.005) {
      throw new BadRequestException(`ยอดที่โอน ${amount} เกินยอดค้าง ${balance}`);
    }
    return this.addPayment(
      {
        folioId: id,
        method: AccPaymentMethod.CITY_LEDGER,
        amount,
        payerName: dto.companyName,
        reference: dto.companyTaxId ? `TAX:${dto.companyTaxId}` : undefined,
        notes: `โอนเข้า City Ledger — ${dto.companyName}`,
      },
      tenantId,
      postedBy,
    );
  }

  async close(id: string, tenantId: string, closedBy: string) {
    const folio = await this.findOne(id, tenantId);
    if (folio.status !== 'OPEN' && folio.status !== 'PENDING') {
      throw new BadRequestException(`Cannot close folio with status: ${folio.status}`);
    }
    if (Number(folio.balance) > 0.01) {
      throw new BadRequestException('Folio has outstanding balance');
    }

    const updated = await this.prisma.guestFolio.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy,
      },
    });

    this.logger.log(`Folio ${folio.folioNo} closed by ${closedBy}`);
    return updated;
  }

  async reverseCharge(chargeId: string, tenantId: string, reversedBy: string) {
    const charge = await this.prisma.folioCharge.findFirst({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException(`Charge ${chargeId} not found`);
    if (charge.status === 'REVERSED') {
      throw new BadRequestException('Charge is already reversed');
    }

    const folio = await this.prisma.guestFolio.findFirst({
      where: { id: charge.folioId, tenantId },
    });
    if (!folio) throw new NotFoundException(`Folio for charge not found`);
    if (folio.status !== 'OPEN') {
      throw new BadRequestException(`Cannot reverse charge on folio with status: ${folio.status}`);
    }

    // รายการที่ Night Audit ปิดวันและลงบัญชีไปแล้ว → ต้องกลับรายการใน GL ด้วย (ลงวันที่วันนี้)
    const audit = charge.nightAuditId
      ? await this.prisma.nightAudit.findFirst({
          where: { id: charge.nightAuditId, tenantId },
          select: { status: true, journalEntryId: true },
        })
      : null;
    const reversal =
      audit?.status === 'CLOSED' && audit.journalEntryId
        ? buildGuestLedgerLines(
            [
              {
                chargeType: charge.chargeType,
                netAmount: -Number(charge.netAmount),
                vatAmount: -Number(charge.vatAmount),
                totalAmount: -Number(charge.totalAmount),
              },
            ],
            `กลับรายการ ${charge.description}`,
          ).lines
        : [];
    let reversalAccounts: Map<string, string> | null = null;
    if (reversal.length > 0) {
      await assertPeriodOpen(this.prisma, tenantId, folio.propertyId, new Date());
      reversalAccounts = await resolveAccountIds(
        this.prisma,
        tenantId,
        reversal.map((l) => l.code),
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const reversed = await tx.folioCharge.update({
        where: { id: chargeId },
        data: { status: 'REVERSED', reversedBy, reversedAt: new Date() },
      });

      await tx.guestFolio.update({
        where: { id: charge.folioId },
        data: {
          totalCharges: { decrement: Number(charge.totalAmount) },
          balance: { decrement: Number(charge.totalAmount) },
        },
      });

      return reversed;
    });

    if (reversal.length > 0 && reversalAccounts) {
      const accounts = reversalAccounts;
      try {
        await this.journalEntries.createAndPostAutoEntry(tenantId, {
          propertyId: folio.propertyId,
          entryDate: new Date(),
          description: `กลับรายการ ${folio.folioNo}: ${charge.description}`,
          reference: folio.folioNo,
          sourceType: JournalSourceTypeEnum.ADJUSTMENT,
          sourceId: charge.id,
          createdBy: reversedBy,
          lines: reversal.map((l, i) => ({
            accountId: accounts.get(l.code) as string,
            lineNo: i + 1,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        });
      } catch (error) {
        this.logger.error(
          `Folio charge reversal journal failed for ${charge.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }

    return result;
  }
}
