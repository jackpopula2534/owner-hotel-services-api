import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateBankReconDto } from './dto/create-bank-recon.dto';
import { CreateReconLineDto } from './dto/create-recon-line.dto';

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: {
      propertyId?: string;
      bankAccountId?: string;
      period?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { propertyId, bankAccountId, period, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (period) where.period = period;
    if (status) where.status = status;

    const [total, data] = await Promise.all([
      this.prisma.bankReconciliation.count({ where }),
      this.prisma.bankReconciliation.findMany({
        where,
        include: { _count: { select: { lines: true } } },
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string, tenantId: string) {
    const recon = await this.prisma.bankReconciliation.findFirst({
      where: { id, tenantId },
      include: {
        lines: { orderBy: { txnDate: 'asc' } },
      },
    });
    if (!recon) throw new NotFoundException(`Bank reconciliation ${id} not found`);
    return recon;
  }

  async create(dto: CreateBankReconDto, tenantId: string, createdBy: string) {
    const existing = await this.prisma.bankReconciliation.findFirst({
      where: {
        tenantId,
        propertyId: dto.propertyId,
        bankAccountId: dto.bankAccountId,
        period: dto.period,
      },
    });
    if (existing) throw new ConflictException(`Reconciliation for ${dto.period} already exists`);

    // bankAccountId = บัญชีแยกประเภทเงินฝากธนาคาร (ผังบัญชีรหัส 1102*) ของ tenant นี้
    // (ตาราง bank_accounts เป็นบัญชีรับเงินของแพลตฟอร์ม ไม่ใช่ของโรงแรม และไม่มี tenantId)
    const bankAccount = await this.prisma.accountChart.findFirst({
      where: { id: dto.bankAccountId, tenantId, code: { startsWith: '1102' } },
      select: { id: true, code: true },
    });
    if (!bankAccount) {
      throw new BadRequestException('bankAccountId ต้องเป็นบัญชีเงินฝากธนาคาร (รหัส 1102) ของกิจการนี้');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(dto.period)) {
      throw new BadRequestException('period ต้องอยู่ในรูปแบบ YYYY-MM');
    }

    const bookBalance = await this.computeBookBalance(tenantId, dto.propertyId, bankAccount.code, dto.period);

    const variance = Math.round((dto.statementBalance - bookBalance) * 100) / 100;

    return this.prisma.bankReconciliation.create({
      data: {
        tenantId,
        propertyId: dto.propertyId,
        bankAccountId: dto.bankAccountId,
        period: dto.period,
        statementDate: new Date(`${dto.statementDate.slice(0, 10)}T00:00:00.000Z`),
        statementBalance: dto.statementBalance,
        bookBalance,
        variance,
        status: 'OPEN',
        notes: dto.notes,
        createdBy,
      },
    });
  }

  async addLine(dto: CreateReconLineDto, tenantId: string) {
    const recon = await this.findOne(dto.reconId, tenantId);
    if (recon.status === 'APPROVED')
      throw new BadRequestException('Cannot add lines to approved reconciliation');

    const line = await this.prisma.bankReconLine.create({
      data: {
        reconId: dto.reconId,
        txnType: dto.txnType,
        txnDate: new Date(dto.txnDate),
        description: dto.description,
        statementAmount: dto.statementAmount ?? 0,
        bookAmount: dto.bookAmount ?? 0,
        bookRef: dto.bookRef,
        statementRef: dto.statementRef,
        notes: dto.notes,
      },
    });

    // อัปเดต status เป็น IN_PROGRESS
    await this.prisma.bankReconciliation.update({
      where: { id: dto.reconId },
      data: { status: 'IN_PROGRESS' },
    });

    return line;
  }

  async matchLine(lineId: string, tenantId: string) {
    const line = await this.prisma.bankReconLine.findFirst({
      where: { id: lineId },
      include: { reconciliation: { select: { tenantId: true } } },
    });
    if (!line) throw new NotFoundException(`Recon line ${lineId} not found`);
    if (line.reconciliation.tenantId !== tenantId)
      throw new NotFoundException(`Recon line ${lineId} not found`);

    return this.prisma.bankReconLine.update({
      where: { id: lineId },
      data: { isMatched: !line.isMatched, matchedAt: line.isMatched ? null : new Date() },
    });
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    const recon = await this.findOne(id, tenantId);
    if (recon.status === 'APPROVED') throw new BadRequestException('Already approved');

    const unmatchedLines = await this.prisma.bankReconLine.count({
      where: { reconId: id, isMatched: false },
    });
    if (unmatchedLines > 0) {
      throw new BadRequestException(`${unmatchedLines} unmatched line(s) remaining`);
    }

    // ตรึงยอดตามบัญชี ณ ตอนอนุมัติ แล้วต้องอธิบายผลต่างได้ครบ
    const ws = await this.getWorkspace(id, tenantId);
    if (Math.abs(ws.reconciliation.unexplained) >= 0.005) {
      throw new BadRequestException(
        `ยังมีผลต่างที่อธิบายไม่ได้ ${ws.reconciliation.unexplained.toFixed(2)} — กระทบรายการสมุดบัญชีหรือเพิ่มรายการเฉพาะ Statement ให้ครบก่อน`,
      );
    }

    return this.prisma.bankReconciliation.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        bookBalance: ws.reconciliation.bookBalance,
        variance: round2(ws.reconciliation.statementBalance - ws.reconciliation.bookBalance),
      },
    });
  }

  async getSummary(id: string, tenantId: string) {
    const recon = await this.findOne(id, tenantId);
    const lines = await this.prisma.bankReconLine.findMany({ where: { reconId: id } });

    const matched = lines.filter((l) => l.isMatched);
    const unmatched = lines.filter((l) => !l.isMatched);

    return {
      id: recon.id,
      period: recon.period,
      statementBalance: Number(recon.statementBalance),
      bookBalance: Number(recon.bookBalance),
      variance: Number(recon.variance),
      status: recon.status,
      totalLines: lines.length,
      matchedLines: matched.length,
      unmatchedLines: unmatched.length,
      matchedStatementTotal: matched.reduce((s, l) => s + Number(l.statementAmount), 0),
      unmatchedItems: unmatched.map((l) => ({
        id: l.id,
        txnDate: l.txnDate,
        description: l.description,
        statementAmount: Number(l.statementAmount),
        bookAmount: Number(l.bookAmount),
      })),
    };
  }

  // ── พื้นที่ทำงานกระทบยอด ────────────────────────────────────────────────

  /**
   * ยอดตามบัญชี = ยอดยกไปล่าสุด ณ สิ้นงวด ของบัญชีที่เลือก (รวมบัญชีย่อยใต้รหัสนั้น)
   * งวดที่ไม่มีรายการจะไม่มีแถว ledger_balances จึงใช้แถวล่าสุดที่ไม่เกินงวดที่กระทบยอด
   */
  async computeBookBalance(tenantId: string, propertyId: string, bankCode: string, period?: string) {
    const accounts = await this.prisma.accountChart.findMany({
      where: { tenantId, code: { startsWith: bankCode } },
      select: { id: true },
    });
    const [fiscalYear, fiscalMonth] = period ? period.split('-').map(Number) : [0, 0];
    let bookBalance = 0;
    for (const acc of accounts) {
      const ledger = await this.prisma.ledgerBalance.findFirst({
        where: {
          tenantId,
          propertyId,
          accountId: acc.id,
          ...(period
            ? { OR: [{ fiscalYear: { lt: fiscalYear } }, { fiscalYear, fiscalPeriod: { lte: fiscalMonth } }] }
            : {}),
        },
        orderBy: [{ fiscalYear: 'desc' }, { fiscalPeriod: 'desc' }],
        select: { closingBalance: true },
      });
      if (ledger) bookBalance += Number(ledger.closingBalance);
    }
    return round2(bookBalance);
  }

  private async bankAccountOf(tenantId: string, bankAccountId: string) {
    const account = await this.prisma.accountChart.findFirst({
      where: { id: bankAccountId, tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!account) throw new BadRequestException('ไม่พบบัญชีเงินฝากธนาคารของการกระทบยอดนี้');
    return account;
  }

  /**
   * รายการ GL ของบัญชีธนาคารจนถึงสิ้นงวด ที่ยังไม่ถูกกระทบในงวดก่อนหน้า
   * ตัดคู่ที่กลับรายการกันเอง (REVERSED + รายการกลับ) ออก เพราะสุทธิเป็นศูนย์และไม่เคยผ่านธนาคาร
   */
  private async bookTransactions(
    tenantId: string,
    recon: { id: string; propertyId: string; bankAccountId: string; period: string },
    bankCode: string,
  ) {
    const periodEnd = lastDayOfPeriod(recon.period);
    const accounts = await this.prisma.accountChart.findMany({
      where: { tenantId, code: { startsWith: bankCode } },
      select: { id: true },
    });
    const lines = await this.prisma.journalLine.findMany({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        journalEntry: {
          tenantId,
          propertyId: recon.propertyId,
          status: { in: ['POSTED', 'REVERSED'] },
          entryDate: { lte: periodEnd },
        },
      },
      select: {
        id: true,
        description: true,
        debit: true,
        credit: true,
        journalEntry: {
          select: { id: true, entryNo: true, entryDate: true, description: true, status: true, reversedById: true, sourceType: true },
        },
      },
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { journalEntry: { entryNo: 'asc' } }],
      take: MAX_BOOK_LINES,
    });

    const reversalIds = new Set(
      lines
        .filter((l) => l.journalEntry.status === 'REVERSED' && l.journalEntry.reversedById)
        .map((l) => l.journalEntry.reversedById as string),
    );
    const effective = lines.filter(
      (l) => !(l.journalEntry.status === 'REVERSED' && l.journalEntry.reversedById && reversalIds.has(l.journalEntry.reversedById)) &&
        !reversalIds.has(l.journalEntry.id),
    );

    // กระทบไปแล้วในงวด "อื่น" ของบัญชีเดียวกัน → ไม่ต้องแสดงอีก
    const refs = effective.map((l) => `${JL_PREFIX}${l.id}`);
    const clearedLines = refs.length
      ? await this.prisma.bankReconLine.findMany({
          where: {
            bookRef: { in: refs },
            reconciliation: { tenantId, bankAccountId: recon.bankAccountId, propertyId: recon.propertyId },
          },
          select: { id: true, reconId: true, bookRef: true, reconciliation: { select: { period: true } } },
        })
      : [];
    const clearedMap = new Map(clearedLines.map((c) => [c.bookRef as string, c]));

    return effective
      .map((l) => {
        const cleared = clearedMap.get(`${JL_PREFIX}${l.id}`);
        return {
          journalLineId: l.id,
          journalEntryId: l.journalEntry.id,
          entryNo: l.journalEntry.entryNo,
          entryDate: l.journalEntry.entryDate,
          sourceType: l.journalEntry.sourceType,
          description: l.description || l.journalEntry.description,
          debit: Number(l.debit),
          credit: Number(l.credit),
          amount: round2(Number(l.debit) - Number(l.credit)),
          cleared: cleared?.reconId === recon.id,
          clearedPeriod: cleared && cleared.reconId !== recon.id ? cleared.reconciliation.period : null,
          reconLineId: cleared?.reconId === recon.id ? cleared.id : null,
        };
      })
      .filter((l) => !l.clearedPeriod);
  }

  /** ทุกอย่างที่หน้ากระทบยอดต้องใช้ในครั้งเดียว + สูตรกระทบยอด */
  async getWorkspace(id: string, tenantId: string) {
    const recon = await this.findOne(id, tenantId);
    const account = await this.bankAccountOf(tenantId, recon.bankAccountId);
    const approved = recon.status === 'APPROVED';

    const bookBalance = approved
      ? Number(recon.bookBalance)
      : await this.computeBookBalance(tenantId, recon.propertyId, account.code, recon.period);
    const book = await this.bookTransactions(tenantId, recon, account.code);
    const manualLines = recon.lines.filter((l) => !l.bookRef?.startsWith(JL_PREFIX));

    const uncleared = book.filter((b) => !b.cleared);
    const depositsInTransit = round2(uncleared.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0));
    const outstandingPayments = round2(uncleared.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0));
    const statementOnly = round2(
      manualLines.reduce((s, l) => s + Number(l.statementAmount) - Number(l.bookAmount), 0),
    );
    const statementBalance = Number(recon.statementBalance);
    // ยอดธนาคารที่ควรเป็น = ยอดบัญชี − เงินฝากระหว่างทาง + เช็ค/โอนจ่ายที่ธนาคารยังไม่ตัด + รายการที่มีเฉพาะใน Statement
    const expectedStatement = round2(bookBalance - depositsInTransit + outstandingPayments + statementOnly);

    return {
      recon: { ...recon, lines: undefined },
      account,
      bookLines: book,
      manualLines,
      reconciliation: {
        statementBalance,
        bookBalance,
        storedBookBalance: Number(recon.bookBalance),
        depositsInTransit,
        outstandingPayments,
        statementOnly,
        expectedStatement,
        unexplained: round2(statementBalance - expectedStatement),
        clearedCount: book.filter((b) => b.cleared).length,
        unclearedCount: uncleared.length,
        truncated: book.length >= MAX_BOOK_LINES,
      },
    };
  }

  /** ทำเครื่องหมาย/ยกเลิก "รายการสมุดบัญชีที่ปรากฏใน Statement แล้ว" ทีละหลายรายการ */
  async clearBookLines(id: string, tenantId: string, journalLineIds: string[], cleared: boolean) {
    const recon = await this.findOne(id, tenantId);
    if (recon.status === 'APPROVED') throw new BadRequestException('การกระทบยอดอนุมัติแล้ว แก้ไขไม่ได้');
    const account = await this.bankAccountOf(tenantId, recon.bankAccountId);
    const book = await this.bookTransactions(tenantId, recon, account.code);
    const byId = new Map(book.map((b) => [b.journalLineId, b]));
    const unknown = journalLineIds.filter((jid) => !byId.has(jid));
    if (unknown.length) {
      throw new BadRequestException(`มี ${unknown.length} รายการที่ไม่ใช่รายการสมุดบัญชีของงวดนี้`);
    }

    await this.prisma.$transaction(async (tx) => {
      if (cleared) {
        const toCreate = journalLineIds.map((jid) => byId.get(jid)!).filter((b) => !b.cleared);
        if (toCreate.length) {
          await tx.bankReconLine.createMany({
            data: toCreate.map((b) => ({
              reconId: id,
              txnType: b.amount >= 0 ? 'DEPOSIT' : 'WITHDRAWAL',
              txnDate: b.entryDate,
              description: String(b.description ?? b.entryNo).slice(0, 300),
              statementAmount: b.amount,
              bookAmount: b.amount,
              isMatched: true,
              matchedAt: new Date(),
              bookRef: `${JL_PREFIX}${b.journalLineId}`,
              statementRef: b.entryNo,
            })),
          });
        }
      } else {
        await tx.bankReconLine.deleteMany({
          where: { reconId: id, bookRef: { in: journalLineIds.map((jid) => `${JL_PREFIX}${jid}`) } },
        });
      }
      await tx.bankReconciliation.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
    });
    await this.refreshBook(id, tenantId);
    return this.getWorkspace(id, tenantId);
  }

  async removeLine(lineId: string, tenantId: string) {
    const line = await this.prisma.bankReconLine.findFirst({
      where: { id: lineId, reconciliation: { tenantId } },
      include: { reconciliation: { select: { status: true } } },
    });
    if (!line) throw new NotFoundException(`Recon line ${lineId} not found`);
    if (line.reconciliation.status === 'APPROVED') {
      throw new BadRequestException('การกระทบยอดอนุมัติแล้ว ลบรายการไม่ได้');
    }
    await this.prisma.bankReconLine.delete({ where: { id: lineId } });
    return { id: lineId };
  }

  /** ดึงยอดตามบัญชีใหม่ (มีรายการลงบัญชีย้อนหลังหลังสร้าง) — ห้ามแตะงวดที่อนุมัติแล้ว */
  async refreshBook(id: string, tenantId: string) {
    const recon = await this.findOne(id, tenantId);
    if (recon.status === 'APPROVED') throw new BadRequestException('การกระทบยอดอนุมัติแล้ว');
    const account = await this.bankAccountOf(tenantId, recon.bankAccountId);
    const bookBalance = await this.computeBookBalance(tenantId, recon.propertyId, account.code, recon.period);
    return this.prisma.bankReconciliation.update({
      where: { id },
      data: { bookBalance, variance: round2(Number(recon.statementBalance) - bookBalance) },
    });
  }

  /** ภาพรวมต่อบัญชีธนาคาร สำหรับการ์ดหัวหน้า */
  async overview(tenantId: string, propertyId: string) {
    const accounts = await this.prisma.accountChart.findMany({
      where: { tenantId, code: { startsWith: '1102' }, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const recons = await this.prisma.bankReconciliation.findMany({
      where: { tenantId, propertyId, bankAccountId: { in: accounts.map((a) => a.id) } },
      select: { id: true, bankAccountId: true, period: true, status: true, variance: true, approvedAt: true },
      orderBy: { period: 'desc' },
    });

    const items = await Promise.all(
      accounts.map(async (a) => {
        const mine = recons.filter((r) => r.bankAccountId === a.id);
        const lastApproved = mine.find((r) => r.status === 'APPROVED') ?? null;
        const open = mine.filter((r) => r.status !== 'APPROVED');
        return {
          ...a,
          glBalance: await this.computeBookBalance(tenantId, propertyId, a.code),
          lastApproved: lastApproved
            ? { id: lastApproved.id, period: lastApproved.period, approvedAt: lastApproved.approvedAt }
            : null,
          openRecons: open.map((r) => ({ id: r.id, period: r.period, status: r.status, variance: Number(r.variance) })),
          nextPeriod: lastApproved ? nextPeriod(lastApproved.period) : null,
        };
      }),
    );
    const openAll = recons.filter((r) => r.status !== 'APPROVED');
    return {
      accounts: items,
      openCount: openAll.length,
      approvedCount: recons.length - openAll.length,
      openVarianceTotal: round2(openAll.reduce((s, r) => s + Math.abs(Number(r.variance)), 0)),
    };
  }
}

const JL_PREFIX = 'JL:';
const MAX_BOOK_LINES = 2000;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function lastDayOfPeriod(period: string): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
}

function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
