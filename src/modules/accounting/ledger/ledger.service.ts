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

    const lines: TrialBalanceLine[] = balances.map((b) => {
      const closing = Number(b.closingBalance);
      const isDebitNormal = b.account.normalBalance === 'DEBIT';
      return {
        accountId: b.accountId,
        accountCode: b.account.code,
        accountName: b.account.name,
        accountType: b.account.type,
        openingDebit: isDebitNormal && Number(b.openingBalance) >= 0 ? Number(b.openingBalance) : 0,
        openingCredit:
          !isDebitNormal && Number(b.openingBalance) >= 0 ? Number(b.openingBalance) : 0,
        periodDebit: Number(b.periodDebit),
        periodCredit: Number(b.periodCredit),
        closingDebit: closing > 0 && isDebitNormal ? closing : closing < 0 ? Math.abs(closing) : 0,
        closingCredit:
          closing > 0 && !isDebitNormal ? closing : closing < 0 ? Math.abs(closing) : 0,
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
