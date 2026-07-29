import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalance {
  propertyId: string;
  fiscalYear: number;
  fiscalPeriod: number;
  lines: TrialBalanceLine[];
  totalOpeningDebit: number;
  totalOpeningCredit: number;
  totalPeriodDebit: number;
  totalPeriodCredit: number;
  totalClosingDebit: number;
  totalClosingCredit: number;
  isBalanced: boolean;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getTrialBalance(
    tenantId: string,
    propertyId: string,
    fiscalYear: number,
    fiscalPeriod: number,
  ): Promise<TrialBalance> {
    const balances = await this.prisma.ledgerBalance.findMany({
      where: { tenantId, propertyId, fiscalYear, fiscalPeriod },
      include: {
        account: { select: { code: true, name: true, type: true, normalBalance: true } },
      },
      orderBy: { account: { code: 'asc' } },
    });

    /**
     * ยอดที่เก็บใน ledger_balances เป็นค่ามีเครื่องหมาย (debit − credit) เสมอ
     * บวก = ยอดอยู่ด้านเดบิต, ลบ = ยอดอยู่ด้านเครดิต — ไม่ขึ้นกับ normalBalance
     *
     * ของเดิมเช็ค normalBalance ด้วย ทำให้ยอดติดลบ (เช่นบัญชีรายได้ ซึ่งปกติต้องติดลบ)
     * ตกเข้าเงื่อนไข `closing < 0` ของ *ทั้งสอง* คอลัมน์ จึงโผล่ทั้งเดบิตและเครดิต
     * ยอดรวมเดบิตเลยเป็นสองเท่าและ isBalanced เป็น false ตลอด
     */
    const split = (value: number) => ({
      debit: value > 0 ? value : 0,
      credit: value < 0 ? -value : 0,
    });

    const lines: TrialBalanceLine[] = balances.map((b) => {
      const opening = split(Number(b.openingBalance));
      const closing = split(Number(b.closingBalance));
      return {
        accountId: b.accountId,
        accountCode: b.account.code,
        accountName: b.account.name,
        accountType: b.account.type,
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        periodDebit: Number(b.periodDebit),
        periodCredit: Number(b.periodCredit),
        closingDebit: closing.debit,
        closingCredit: closing.credit,
      };
    });

    const totalOpeningDebit = lines.reduce((s, l) => s + l.openingDebit, 0);
    const totalOpeningCredit = lines.reduce((s, l) => s + l.openingCredit, 0);
    const totalPeriodDebit = lines.reduce((s, l) => s + l.periodDebit, 0);
    const totalPeriodCredit = lines.reduce((s, l) => s + l.periodCredit, 0);
    const totalClosingDebit = lines.reduce((s, l) => s + l.closingDebit, 0);
    const totalClosingCredit = lines.reduce((s, l) => s + l.closingCredit, 0);

    return {
      propertyId,
      fiscalYear,
      fiscalPeriod,
      lines,
      totalOpeningDebit,
      totalOpeningCredit,
      totalPeriodDebit,
      totalPeriodCredit,
      totalClosingDebit,
      totalClosingCredit,
      isBalanced: Math.abs(totalClosingDebit - totalClosingCredit) < 0.01,
    };
  }

  /**
   * สร้าง `ledger_balances` ใหม่จาก JE ที่ POSTED ทั้งหมด
   *
   * จำเป็นเพราะโมดูลที่สร้าง JE เป็น POSTED ตรงๆ (การจองห้องพัก / ลานกางเต็นท์)
   * เคยไม่อัปเดตตารางนี้ ยอดเดิมจึงหายไปจากงบทดลองทั้งที่ JE อยู่ครบ
   * — แก้ที่ต้นทางแล้ว อันนี้ไว้ซ่อมข้อมูลที่ค้างอยู่
   *
   * คำนวณใหม่ทั้งหมด (ไม่ increment) จึงรันซ้ำได้ ไม่มียอดซ้อน
   * `openingBalance` ตั้งเป็น 0 ตามที่ `JournalEntriesService.post()` ทำ — ระบบนี้ยัง
   * ไม่มีขั้นตอนปิดงวดที่ยกยอดข้ามงวด
   */
  async rebuildLedgerBalances(tenantId: string, propertyId?: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { tenantId, status: 'POSTED', ...(propertyId ? { propertyId } : {}) },
      include: { lines: { select: { accountId: true, debit: true, credit: true } } },
    });

    // คีย์ = ขอบเขตของหนึ่งแถวใน ledger_balances
    const totals = new Map<
      string,
      {
        tenantId: string;
        propertyId: string;
        accountId: string;
        fiscalYear: number;
        fiscalPeriod: number;
        periodDebit: number;
        periodCredit: number;
        txnCount: number;
      }
    >();

    for (const entry of entries) {
      for (const line of entry.lines) {
        const key = `${entry.propertyId}|${line.accountId}|${entry.fiscalYear}|${entry.fiscalPeriod}`;
        const row = totals.get(key) ?? {
          tenantId,
          propertyId: entry.propertyId,
          accountId: line.accountId,
          fiscalYear: entry.fiscalYear,
          fiscalPeriod: entry.fiscalPeriod,
          periodDebit: 0,
          periodCredit: 0,
          txnCount: 0,
        };
        row.periodDebit += Number(line.debit);
        row.periodCredit += Number(line.credit);
        row.txnCount += 1;
        totals.set(key, row);
      }
    }

    for (const row of totals.values()) {
      const { periodDebit, periodCredit, txnCount, ...key } = row;
      const closingBalance = periodDebit - periodCredit;
      await this.prisma.ledgerBalance.upsert({
        where: { tenantId_propertyId_accountId_fiscalYear_fiscalPeriod: key },
        update: { periodDebit, periodCredit, closingBalance, txnCount },
        create: { ...key, openingBalance: 0, periodDebit, periodCredit, closingBalance, txnCount },
      });
    }

    this.logger.log(
      `Rebuilt ${totals.size} ledger balance rows from ${entries.length} posted entries (tenant ${tenantId})`,
    );
    return { entries: entries.length, balances: totals.size };
  }

  async getAccountLedger(
    tenantId: string,
    propertyId: string,
    accountId: string,
    fiscalYear: number,
    fiscalPeriodFrom: number,
    fiscalPeriodTo: number,
  ) {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        propertyId,
        fiscalYear,
        fiscalPeriod: { gte: fiscalPeriodFrom, lte: fiscalPeriodTo },
        status: 'POSTED',
        lines: { some: { accountId } },
      },
      include: {
        lines: {
          where: { accountId },
          include: { account: { select: { code: true, name: true } } },
        },
      },
      orderBy: [{ entryDate: 'asc' }, { entryNo: 'asc' }],
    });

    let runningBalance = 0;
    const ledgerLines = entries.flatMap((e) =>
      e.lines.map((l) => {
        runningBalance += Number(l.debit) - Number(l.credit);
        return {
          entryDate: e.entryDate,
          entryNo: e.entryNo,
          description: e.description,
          reference: e.reference,
          lineDescription: l.description,
          debit: Number(l.debit),
          credit: Number(l.credit),
          balance: runningBalance,
        };
      }),
    );

    return {
      accountId,
      fiscalYear,
      fiscalPeriodFrom,
      fiscalPeriodTo,
      lines: ledgerLines,
      totalDebit: ledgerLines.reduce((s, l) => s + l.debit, 0),
      totalCredit: ledgerLines.reduce((s, l) => s + l.credit, 0),
      closingBalance: runningBalance,
    };
  }

  async getProfitAndLoss(
    tenantId: string,
    propertyId: string,
    fiscalYear: number,
    fiscalPeriod?: number,
  ) {
    const where: Record<string, unknown> = { tenantId, propertyId, fiscalYear };
    if (fiscalPeriod) where.fiscalPeriod = { lte: fiscalPeriod };

    const balances = await this.prisma.ledgerBalance.findMany({
      where,
      include: {
        account: { select: { code: true, name: true, type: true, normalBalance: true } },
      },
    });

    const revenue = balances.filter((b) => b.account.type === 'REVENUE');
    const expenses = balances.filter((b) => b.account.type === 'EXPENSE');

    const totalRevenue = revenue.reduce(
      (s, b) => s + Number(b.periodCredit) - Number(b.periodDebit),
      0,
    );
    const totalExpenses = expenses.reduce(
      (s, b) => s + Number(b.periodDebit) - Number(b.periodCredit),
      0,
    );
    const netIncome = totalRevenue - totalExpenses;

    return {
      propertyId,
      fiscalYear,
      fiscalPeriod: fiscalPeriod ?? 12,
      revenue: revenue.map((b) => ({
        code: b.account.code,
        name: b.account.name,
        amount: Number(b.periodCredit) - Number(b.periodDebit),
      })),
      expenses: expenses.map((b) => ({
        code: b.account.code,
        name: b.account.name,
        amount: Number(b.periodDebit) - Number(b.periodCredit),
      })),
      totalRevenue,
      totalExpenses,
      netIncome,
    };
  }

  async getBalanceSheet(
    tenantId: string,
    propertyId: string,
    fiscalYear: number,
    fiscalPeriod?: number,
  ) {
    const where: Record<string, unknown> = { tenantId, propertyId, fiscalYear };
    if (fiscalPeriod) where.fiscalPeriod = { lte: fiscalPeriod };

    const balances = await this.prisma.ledgerBalance.findMany({
      where,
      include: {
        account: { select: { code: true, name: true, type: true, normalBalance: true } },
      },
    });

    const assets = balances.filter((b) => b.account.type === 'ASSET');
    const liabilities = balances.filter((b) => b.account.type === 'LIABILITY');
    const equity = balances.filter((b) => b.account.type === 'EQUITY');

    const totalAssets = assets.reduce((s, b) => s + Number(b.closingBalance), 0);
    const totalLiabilities = liabilities.reduce(
      (s, b) => s + Math.abs(Number(b.closingBalance)),
      0,
    );
    const totalEquity = equity.reduce((s, b) => s + Math.abs(Number(b.closingBalance)), 0);

    return {
      propertyId,
      fiscalYear,
      assets: assets.map((b) => ({
        code: b.account.code,
        name: b.account.name,
        amount: Number(b.closingBalance),
      })),
      liabilities: liabilities.map((b) => ({
        code: b.account.code,
        name: b.account.name,
        amount: Math.abs(Number(b.closingBalance)),
      })),
      equity: equity.map((b) => ({
        code: b.account.code,
        name: b.account.name,
        amount: Math.abs(Number(b.closingBalance)),
      })),
      totalAssets,
      totalLiabilities,
      totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }
}
