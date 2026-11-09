import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ImportBankStatementDto, QueryBankStatementDto } from './dto/import-bank-statement.dto';
import { BookLineCandidate, fingerprintLines, suggestBookMatches } from './bank-statements.util';

const round2 = (v: number) => Math.round(v * 100) / 100;

const LINE_SELECT = {
  id: true,
  propertyId: true,
  bankAccountId: true,
  txnDate: true,
  txnTime: true,
  description: true,
  amount: true,
  balance: true,
  reference: true,
  status: true,
  journalLineId: true,
  arReceiptId: true,
  importBatchId: true,
  sourceFile: true,
  createdAt: true,
} satisfies Prisma.BankStatementLineSelect;

type LineRow = Prisma.BankStatementLineGetPayload<{ select: typeof LINE_SELECT }>;

export interface BankStatementLineView extends Omit<LineRow, 'amount' | 'balance'> {
  amount: number;
  balance: number | null;
}

function toView(l: LineRow): BankStatementLineView {
  return { ...l, amount: Number(l.amount), balance: l.balance === null ? null : Number(l.balance) };
}

function periodRange(period: string): { gte: Date; lte: Date } {
  const [y, m] = period.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
}

/**
 * รายการ Statement ธนาคารที่นำเข้า — ที่เดียวที่ทั้งหน้ารับชำระ (AR) และหน้ากระทบยอดธนาคารอ่าน/เขียน
 * นำเข้าครั้งเดียว: AR ใช้แถวเงินเข้าสร้างใบเสร็จ, กระทบยอดใช้ทุกแถวจับคู่กับสมุดบัญชี
 */
@Injectable()
export class BankStatementsService {
  private readonly logger = new Logger(BankStatementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** บัญชีเงินฝากธนาคาร (1102*) ที่เลือกนำเข้าได้ */
  async bankAccounts(tenantId: string) {
    return this.prisma.accountChart.findMany({
      where: { tenantId, code: { startsWith: '1102' }, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  private async assertBankAccount(tenantId: string, bankAccountId: string) {
    const account = await this.prisma.accountChart.findFirst({
      where: { id: bankAccountId, tenantId, code: { startsWith: '1102' } },
      select: { id: true, code: true, name: true },
    });
    if (!account) {
      throw new BadRequestException('ต้องเลือกบัญชีเงินฝากธนาคาร (รหัส 1102) ของกิจการนี้');
    }
    return account;
  }

  async import(dto: ImportBankStatementDto, tenantId: string, importedBy: string) {
    await this.assertBankAccount(tenantId, dto.bankAccountId);
    const lines = dto.lines.filter((l) => Math.abs(Number(l.amount)) >= 0.005);
    if (!lines.length) throw new BadRequestException('ไม่มีรายการที่มียอดเงินให้นำเข้า');

    const fingerprints = fingerprintLines(lines);
    const existing = await this.prisma.bankStatementLine.findMany({
      where: { tenantId, bankAccountId: dto.bankAccountId, fingerprint: { in: fingerprints } },
      select: { fingerprint: true },
    });
    const have = new Set(existing.map((e) => e.fingerprint));
    const importBatchId = randomUUID();
    const fresh = lines
      .map((l, i) => ({ l, fp: fingerprints[i] }))
      .filter(({ fp }) => !have.has(fp));

    if (fresh.length) {
      await this.prisma.bankStatementLine.createMany({
        data: fresh.map(({ l, fp }) => ({
          tenantId,
          propertyId: dto.propertyId,
          bankAccountId: dto.bankAccountId,
          txnDate: new Date(`${l.txnDate.slice(0, 10)}T00:00:00.000Z`),
          txnTime: l.txnTime ?? null,
          description: (l.description || '-').slice(0, 300),
          amount: round2(Number(l.amount)),
          balance: l.balance === undefined || l.balance === null ? null : round2(Number(l.balance)),
          reference: l.reference?.trim() || null,
          fingerprint: fp,
          importBatchId,
          sourceFile: dto.fileName?.slice(0, 200) ?? null,
          importedBy,
        })),
        skipDuplicates: true,
      });
    }

    // คืนทุกแถวของไฟล์นี้ (ทั้งใหม่และที่เคยนำเข้า) เรียงตามไฟล์ — หน้าจอใช้สถานะต่อได้เลย
    const rows = await this.prisma.bankStatementLine.findMany({
      where: { tenantId, bankAccountId: dto.bankAccountId, fingerprint: { in: fingerprints } },
      select: { ...LINE_SELECT, fingerprint: true },
    });
    const byFp = new Map(rows.map((r) => [r.fingerprint, r]));
    const ordered = fingerprints
      .map((fp) => byFp.get(fp))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => {
        const view = toView(r);
        delete (view as Partial<typeof view> & { fingerprint?: string }).fingerprint;
        return view;
      });

    this.logger.log(
      `Imported bank statement ${dto.fileName ?? ''}: ${fresh.length} new, ${lines.length - fresh.length} duplicate`,
    );
    return {
      importBatchId,
      inserted: fresh.length,
      duplicates: lines.length - fresh.length,
      lines: ordered,
    };
  }

  async list(tenantId: string, q: QueryBankStatementDto) {
    const rows = await this.prisma.bankStatementLine.findMany({
      where: {
        tenantId,
        propertyId: q.propertyId,
        ...(q.bankAccountId ? { bankAccountId: q.bankAccountId } : {}),
        ...(q.period ? { txnDate: periodRange(q.period) } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.direction === 'IN'
          ? { amount: { gt: 0 } }
          : q.direction === 'OUT'
            ? { amount: { lt: 0 } }
            : {}),
        ...(q.importBatchId ? { importBatchId: q.importBatchId } : {}),
      },
      select: LINE_SELECT,
      orderBy: [{ txnDate: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
    });
    return rows.map(toView);
  }

  private async findLine(id: string, tenantId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, tenantId },
      select: LINE_SELECT,
    });
    if (!line) throw new NotFoundException('ไม่พบรายการ Statement');
    return line;
  }

  private async updateLine(
    id: string,
    tenantId: string,
    data: Prisma.BankStatementLineUpdateManyMutationInput,
  ) {
    await this.prisma.bankStatementLine.updateMany({ where: { id, tenantId }, data });
    return toView(await this.findLine(id, tenantId));
  }

  /** ผูกแถวเงินเข้ากับใบเสร็จที่สร้างจากแถวนั้น + หา journal line ฝั่งธนาคารของใบเสร็จไว้ให้หน้ากระทบยอด */
  async linkReceipt(id: string, arReceiptId: string, tenantId: string) {
    const line = await this.findLine(id, tenantId);
    if (Number(line.amount) <= 0) throw new BadRequestException('ผูกใบเสร็จได้เฉพาะรายการเงินเข้า');
    if (line.status === 'MATCHED' && line.arReceiptId && line.arReceiptId !== arReceiptId) {
      throw new BadRequestException('รายการนี้ผูกกับใบเสร็จอื่นแล้ว');
    }
    const receipt = await this.prisma.arReceipt.findFirst({
      where: { id: arReceiptId, tenantId },
      select: { id: true, status: true },
    });
    if (!receipt || receipt.status === 'VOID')
      throw new BadRequestException('ไม่พบใบเสร็จ หรือใบเสร็จถูกยกเลิกแล้ว');

    const account = await this.assertBankAccount(tenantId, line.bankAccountId);
    const bankLine = await this.prisma.journalLine.findFirst({
      where: {
        debit: { gt: 0 },
        account: { code: { startsWith: account.code } },
        journalEntry: {
          tenantId,
          sourceType: 'AR_RECEIPT',
          sourceId: arReceiptId,
          status: 'POSTED',
        },
      },
      select: { id: true },
    });
    return this.updateLine(id, tenantId, {
      status: 'MATCHED',
      arReceiptId,
      journalLineId: bankLine?.id ?? null,
    });
  }

  async setStatus(id: string, status: 'IGNORED' | 'UNMATCHED', tenantId: string) {
    const line = await this.findLine(id, tenantId);
    if (status === 'IGNORED' && line.status === 'MATCHED') {
      throw new BadRequestException('รายการนี้จับคู่แล้ว — ยกเลิกการจับคู่ก่อน');
    }
    return this.updateLine(id, tenantId, {
      status,
      ...(status === 'UNMATCHED' ? { journalLineId: null, arReceiptId: null } : {}),
    });
  }

  async remove(id: string, tenantId: string) {
    const line = await this.findLine(id, tenantId);
    if (line.status === 'MATCHED') throw new BadRequestException('ลบรายการที่จับคู่แล้วไม่ได้');
    await this.prisma.bankStatementLine.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  /** ใบเสร็จถูกยกเลิก → แถว Statement กลับไปรอจับคู่ */
  async releaseReceipt(arReceiptId: string, tenantId: string): Promise<number> {
    const res = await this.prisma.bankStatementLine.updateMany({
      where: { tenantId, arReceiptId },
      data: { status: 'UNMATCHED', arReceiptId: null, journalLineId: null },
    });
    return res.count;
  }

  /** แถว Statement ของงวด + คู่ที่แนะนำกับรายการสมุดบัญชี (ใช้ในพื้นที่ทำงานกระทบยอด) */
  async forReconciliation(
    tenantId: string,
    recon: { propertyId: string; bankAccountId: string; period: string },
    book: BookLineCandidate[],
  ) {
    const lines = await this.list(tenantId, {
      propertyId: recon.propertyId,
      bankAccountId: recon.bankAccountId,
      period: recon.period,
    });
    const open = lines.filter((l) => l.status !== 'IGNORED');
    // แถวที่จับคู่แล้วแต่รายการสมุดบัญชียังไม่ถูกติ๊ก ก็ยังต้องแนะนำ (มาจากหน้า AR)
    const candidates = open
      .filter(
        (l) =>
          l.status === 'UNMATCHED' ||
          (l.journalLineId && book.some((b) => b.journalLineId === l.journalLineId && !b.cleared)),
      )
      .map((l) => ({
        id: l.id,
        txnDate: l.txnDate,
        amount: l.amount,
        journalLineId: l.journalLineId,
      }));
    const suggestions = suggestBookMatches(candidates, book);
    const withBalance = [...lines].reverse().find((l) => l.balance !== null);
    return {
      lines: lines.map((l) => ({ ...l, suggestedJournalLineId: suggestions.get(l.id) ?? null })),
      closingBalance: withBalance?.balance ?? null,
      counts: {
        total: lines.length,
        unmatched: lines.filter((l) => l.status === 'UNMATCHED').length,
        matched: lines.filter((l) => l.status === 'MATCHED').length,
        ignored: lines.filter((l) => l.status === 'IGNORED').length,
        suggested: suggestions.size,
      },
    };
  }

  /** บันทึกคู่ Statement ↔ journal line (ตรวจแล้วจากฝั่งกระทบยอด) */
  async applyMatches(
    tenantId: string,
    bankAccountId: string,
    pairs: { statementLineId: string; journalLineId: string }[],
  ) {
    const ids = pairs.map((p) => p.statementLineId);
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { tenantId, bankAccountId, id: { in: ids } },
      select: { id: true, status: true },
    });
    if (lines.length !== new Set(ids).size)
      throw new BadRequestException('มีรายการ Statement ที่ไม่ใช่ของบัญชีนี้');
    if (lines.some((l) => l.status === 'IGNORED'))
      throw new BadRequestException('มีรายการที่ถูกข้ามไว้ — เปิดกลับก่อนจับคู่');
    await this.prisma.$transaction(
      pairs.map((p) =>
        this.prisma.bankStatementLine.updateMany({
          where: { id: p.statementLineId, tenantId },
          data: { status: 'MATCHED', journalLineId: p.journalLineId },
        }),
      ),
    );
  }

  /** ยกเลิกติ๊กรายการสมุดบัญชี → แถว Statement ที่จับคู่ไว้ (และไม่ได้มาจากใบเสร็จ) กลับไปรอจับคู่ */
  async releaseJournalLines(tenantId: string, journalLineIds: string[]) {
    if (!journalLineIds.length) return;
    await this.prisma.bankStatementLine.updateMany({
      where: { tenantId, journalLineId: { in: journalLineIds }, arReceiptId: null },
      data: { status: 'UNMATCHED', journalLineId: null },
    });
  }
}
