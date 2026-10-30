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

interface AggregatedBalance {
  accountId: string;
  code: string;
  name: string;
  type: string;
  opening: number;
  periodDebit: number;
  periodCredit: number;
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

    // ระบบยังไม่มีขั้นตอนยกยอดข้ามงวด (openingBalance ใน ledger_balances เป็น 0 เสมอ)
    // ยอดยกมาจึงต้องคำนวณเองจากทุกงวดก่อนหน้า ไม่งั้นงบทดลองเดือนที่ 2 เป็นต้นไป
    // จะเห็นแค่ความเคลื่อนไหวของเดือนนั้น ไม่ใช่ยอดคงเหลือจริง
    const rows = await this.aggregateBalances(tenantId, propertyId, fiscalYear, fiscalPeriod);

    const lines: TrialBalanceLine[] = rows.map((r) => {
      const opening = split(r.opening);
      const closing = split(r.opening + r.periodDebit - r.periodCredit);
      return {
        accountId: r.accountId,
        accountCode: r.code,
        accountName: r.name,
        accountType: r.type,
        openingDebit: opening.debit,
        openingCredit: opening.credit,
        periodDebit: r.periodDebit,
        periodCredit: r.periodCredit,
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
   * รวม ledger_balances ต่อบัญชีจนถึงงวด (fiscalYear, fiscalPeriod)
   * - opening = ผลรวม (debit − credit) ของทุกงวดก่อน `periodFrom` ในปีนั้น และทุกปีก่อนหน้า
   * - periodDebit/periodCredit = ความเคลื่อนไหวตั้งแต่ `periodFrom` ถึง `fiscalPeriod` ของปีนั้น
   * หนึ่งบัญชีได้หนึ่งแถวเสมอ (ของเดิมคืนหนึ่งแถวต่องวด บัญชีเดียวจึงโผล่ซ้ำหลายบรรทัดในงบ)
   */
  private async aggregateBalances(
    tenantId: string,
    propertyId: string,
    fiscalYear: number,
    fiscalPeriod: number,
    periodFrom: number = fiscalPeriod,
  ): Promise<AggregatedBalance[]> {
    const balances = await this.prisma.ledgerBalance.findMany({
      where: {
        tenantId,
        propertyId,
        OR: [
          { fiscalYear: { lt: fiscalYear } },
          { fiscalYear, fiscalPeriod: { lte: fiscalPeriod } },
        ],
      },
      include: {
        account: { select: { code: true, name: true, type: true, normalBalance: true } },
      },
    });

    const byAccount = new Map<string, AggregatedBalance>();
    for (const b of balances) {
      const row = byAccount.get(b.accountId) ?? {
        accountId: b.accountId,
        code: b.account.code,
        name: b.account.name,
        type: b.account.type,
        opening: 0,
        periodDebit: 0,
        periodCredit: 0,
      };
      const inRange = b.fiscalYear === fiscalYear && b.fiscalPeriod >= periodFrom;
      if (inRange) {
        row.periodDebit += Number(b.periodDebit);
        row.periodCredit += Number(b.periodCredit);
      } else {
        row.opening += Number(b.periodDebit) - Number(b.periodCredit);
      }
      byAccount.set(b.accountId, row);
    }

    return [...byAccount.values()].sort((x, y) => x.code.localeCompare(y.code));
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
    // งบกำไรขาดทุน = ความเคลื่อนไหวสะสมตั้งแต่ต้นปีถึงงวดที่เลือก (YTD) ไม่รวมปีก่อน
    const period = fiscalPeriod ?? 12;
    const rows = await this.aggregateBalances(tenantId, propertyId, fiscalYear, period, 1);

    const revenue = rows
      .filter((r) => r.type === 'REVENUE')
      .map((r) => ({ code: r.code, name: r.name, amount: r.periodCredit - r.periodDebit }));
    const expenses = rows
      .filter((r) => r.type === 'EXPENSE')
      .map((r) => ({ code: r.code, name: r.name, amount: r.periodDebit - r.periodCredit }));

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

    return {
      propertyId,
      fiscalYear,
      fiscalPeriod: period,
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome: totalRevenue - totalExpenses,
    };
  }

  async getBalanceSheet(
    tenantId: string,
    propertyId: string,
    fiscalYear: number,
    fiscalPeriod?: number,
  ) {
    // งบดุล = ยอดคงเหลือสะสมทั้งหมดจนถึงสิ้นงวด (รวมทุกปีก่อนหน้า)
    const period = fiscalPeriod ?? 12;
    const rows = await this.aggregateBalances(tenantId, propertyId, fiscalYear, period, 13);
    const balanceOf = (r: AggregatedBalance) => r.opening + r.periodDebit - r.periodCredit;

    // สินทรัพย์ปกติฝั่งเดบิต (บวก = debit − credit); หนี้สิน/ทุนปกติฝั่งเครดิต
    // บัญชีที่ยอดกลับข้าง (เช่นเจ้าหนี้จ่ายเกิน) ต้องแสดงติดลบ ไม่ใช่ Math.abs ให้เป็นบวก
    const pick = (type: string, sign: 1 | -1) =>
      rows
        .filter((r) => r.type === type)
        .map((r) => ({ code: r.code, name: r.name, amount: sign * balanceOf(r) }))
        .filter((r) => Math.abs(r.amount) >= 0.005);

    const assets = pick('ASSET', 1);
    const liabilities = pick('LIABILITY', -1);
    const equity = pick('EQUITY', -1);

    // ยังไม่มี JE ปิดบัญชีรายได้/ค่าใช้จ่ายเข้ากำไรสะสม — กำไร(ขาดทุน)ที่ยังไม่ปิดต้องแสดง
    // เป็นส่วนของเจ้าของ ไม่งั้นงบดุลไม่มีทางสมดุล
    const unclosedEarnings = -rows
      .filter((r) => r.type === 'REVENUE' || r.type === 'EXPENSE')
      .reduce((s, r) => s + balanceOf(r), 0);
    if (Math.abs(unclosedEarnings) >= 0.005) {
      equity.push({ code: '-', name: 'กำไร(ขาดทุน)สะสมที่ยังไม่ปิดบัญชี', amount: unclosedEarnings });
    }

    const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
    const totalEquity = equity.reduce((s, r) => s + r.amount, 0);

    return {
      propertyId,
      fiscalYear,
      fiscalPeriod: period,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }
}
