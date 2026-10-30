import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { JournalEntriesService } from '@/modules/accounting/journal-entries/journal-entries.service';
import { JournalSourceTypeEnum } from '@/modules/accounting/journal-entries/dto/create-journal-entry.dto';
import {
  ACCOUNT_CODES,
  resolveAccountIds,
} from '@/modules/accounting/ledger/posting-accounts.util';
import { ACCUM_DEPRECIATION_CODE } from '../fixed-asset-accounts.util';

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly journalEntriesService?: JournalEntriesService,
  ) {}

  async runMonthlyDepreciation(
    tenantId: string,
    propertyId: string,
    period: string,
    postedBy: string,
  ): Promise<{ processed: number; skipped: number; totalAmount: number }> {
    const [fiscalYear, fiscalMonth] = period.split('-').map(Number);
    if (!fiscalYear || !fiscalMonth)
      throw new BadRequestException('Invalid period format. Use YYYY-MM');

    const assets = await this.prisma.fixedAsset.findMany({
      where: { tenantId, propertyId, status: 'ACTIVE' },
    });

    let processed = 0;
    let skipped = 0;
    let totalAmount = 0;

    for (const asset of assets) {
      if (asset.depreciationMethod === 'NO_DEPRECIATION') {
        skipped++;
        continue;
      }

      // ตรวจว่า period นี้มีค่าเสื่อมแล้วยัง
      const existing = await this.prisma.assetDepreciation.findFirst({
        where: { assetId: asset.id, period },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // ตรวจว่ายังมีอายุใช้งานเหลืออยู่
      const depreciationCount = await this.prisma.assetDepreciation.count({
        where: { assetId: asset.id },
      });
      const totalMonths = asset.usefulLifeYears * 12;
      if (depreciationCount >= totalMonths) {
        skipped++;
        continue;
      }

      // คำนวณค่าเสื่อม
      const depreciableBase =
        Number(asset.purchaseCost) + Number(asset.acquisitionCost) - Number(asset.residualValue);
      let amount = 0;
      switch (asset.depreciationMethod) {
        case 'STRAIGHT_LINE':
          amount = Math.round((depreciableBase / totalMonths) * 100) / 100;
          break;
        case 'DECLINING_BALANCE':
          const rate = asset.depreciationRate ? Number(asset.depreciationRate) / 100 : 0.2;
          amount = Math.round(((Number(asset.bookValue) * rate) / 12) * 100) / 100;
          break;
        default:
          amount = Math.round((depreciableBase / totalMonths) * 100) / 100;
      }

      // ไม่ให้เกิน bookValue - residualValue
      const maxAmount = Math.max(0, Number(asset.bookValue) - Number(asset.residualValue));
      amount = Math.min(amount, maxAmount);
      if (amount <= 0) {
        skipped++;
        continue;
      }

      const newAccumulated = Number(asset.accumulatedDepreciation) + amount;
      const newBookValue = Math.max(Number(asset.residualValue), Number(asset.bookValue) - amount);

      await this.prisma.$transaction(async (tx) => {
        await tx.assetDepreciation.create({
          data: {
            assetId: asset.id,
            tenantId,
            period,
            fiscalYear,
            fiscalPeriod: fiscalMonth,
            depreciationDate: new Date(`${period}-01`),
            depreciationAmount: amount,
            accumulatedAmount: newAccumulated,
            bookValue: newBookValue,
          },
        });

        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciation: newAccumulated,
            bookValue: newBookValue,
          },
        });
      });

      totalAmount += amount;
      processed++;
    }

    this.logger.log(
      `Depreciation run for ${period}: processed=${processed}, skipped=${skipped}, totalAmount=${totalAmount}`,
    );
    return { processed, skipped, totalAmount: Math.round(totalAmount * 100) / 100 };
  }

  /**
   * ลงสมุดรายวันค่าเสื่อมของงวด — 1 รายการต่อ property ลงวันสิ้นเดือน
   * DR ค่าเสื่อมราคา (6305 หรือบัญชีของสินทรัพย์) / CR ค่าเสื่อมราคาสะสมตามหมวด
   *
   * เดิมแค่ติดธง isPosted ไม่มีรายการบัญชีเลย งบกำไรขาดทุนจึงไม่เคยมีค่าเสื่อม
   */
  async postDepreciation(tenantId: string, period: string, postedBy: string) {
    const [year, month] = period.split('-').map(Number);
    if (!year || !month) throw new BadRequestException('Invalid period format. Use YYYY-MM');

    const rows = await this.prisma.assetDepreciation.findMany({
      where: { tenantId, period, isPosted: false },
      include: {
        asset: {
          select: {
            propertyId: true,
            category: true,
            accumDeprecAccountId: true,
            deprecExpenseAccountId: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) return { posted: 0, period, journalEntries: 0 };

    const accountIds = await resolveAccountIds(this.prisma, tenantId, [
      ACCOUNT_CODES.DEPRECIATION_EXPENSE,
      ...rows.map((r) => ACCUM_DEPRECIATION_CODE[r.asset.category]),
    ]);

    const byProperty = new Map<string, typeof rows>();
    for (const row of rows) {
      byProperty.set(row.asset.propertyId, [...(byProperty.get(row.asset.propertyId) ?? []), row]);
    }

    // วันสิ้นงวด (UTC midnight = 07:00 น. ไทยของวันเดียวกัน → งวดถูก)
    const entryDate = new Date(Date.UTC(year, month, 0));
    let journalEntries = 0;

    for (const [propertyId, group] of byProperty) {
      const debit = new Map<string, number>();
      const credit = new Map<string, number>();
      for (const row of group) {
        const amount = Number(row.depreciationAmount);
        const expenseId =
          row.asset.deprecExpenseAccountId ?? accountIds.get(ACCOUNT_CODES.DEPRECIATION_EXPENSE)!;
        const accumId =
          row.asset.accumDeprecAccountId ??
          accountIds.get(ACCUM_DEPRECIATION_CODE[row.asset.category])!;
        debit.set(expenseId, (debit.get(expenseId) ?? 0) + amount);
        credit.set(accumId, (credit.get(accumId) ?? 0) + amount);
      }

      const description = `ค่าเสื่อมราคา งวด ${period}`;
      const round = (n: number) => Math.round(n * 100) / 100;
      const lines = [
        ...[...debit].map(([accountId, amount]) => ({ accountId, debit: round(amount), credit: 0 })),
        ...[...credit].map(([accountId, amount]) => ({ accountId, debit: 0, credit: round(amount) })),
      ].map((line, i) => ({ ...line, lineNo: i + 1, description }));

      if (this.journalEntriesService) {
        await this.journalEntriesService.createAndPostAutoEntry(tenantId, {
          propertyId,
          entryDate,
          description,
          reference: `DEP-${period}`,
          sourceType: JournalSourceTypeEnum.DEPRECIATION,
          // ชุดแถวที่ยังไม่ post ชุดเดิม → key เดิม (retry ไม่ลงซ้ำ)
          // รันเพิ่มหลัง post ไปแล้ว (สินทรัพย์ใหม่) → แถวชุดใหม่ → key ใหม่
          sourceId: group[0].id,
          createdBy: postedBy,
          lines,
        });
        journalEntries++;
      }

      await this.prisma.assetDepreciation.updateMany({
        where: { id: { in: group.map((r) => r.id) }, tenantId, isPosted: false },
        data: { isPosted: true, postedAt: new Date(), postedBy },
      });
    }

    this.logger.log(`Depreciation ${period} posted: ${rows.length} rows, ${journalEntries} JEs`);
    return { posted: rows.length, period, journalEntries };
  }

  async getDepreciationReport(tenantId: string, propertyId: string, period: string) {
    const depreciations = await this.prisma.assetDepreciation.findMany({
      where: {
        tenantId,
        period,
        asset: { propertyId },
      },
      include: {
        asset: {
          select: { assetCode: true, name: true, category: true, costCenterId: true },
        },
      },
      orderBy: { asset: { assetCode: 'asc' } },
    });

    const filtered = depreciations.filter((d) => d.asset);

    const byCategory = filtered.reduce<Record<string, number>>((acc, d) => {
      const cat = d.asset?.category ?? 'OTHER';
      acc[cat] = (acc[cat] ?? 0) + Number(d.depreciationAmount);
      return acc;
    }, {});

    return {
      period,
      propertyId,
      totalAssets: filtered.length,
      totalDepreciation: filtered.reduce((s, d) => s + Number(d.depreciationAmount), 0),
      byCategory,
      lines: filtered.map((d) => ({
        assetId: d.assetId,
        assetCode: d.asset?.assetCode,
        assetName: d.asset?.name,
        category: d.asset?.category,
        depreciationAmount: Number(d.depreciationAmount),
        accumulatedDepreciation: Number(d.accumulatedAmount),
        bookValue: Number(d.bookValue),
        isPosted: d.isPosted,
      })),
    };
  }
}
