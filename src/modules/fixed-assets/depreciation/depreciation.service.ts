import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async postDepreciation(tenantId: string, period: string, postedBy: string) {
    const result = await this.prisma.assetDepreciation.updateMany({
      where: { tenantId, period, isPosted: false },
      data: { isPosted: true, postedAt: new Date(), postedBy },
    });
    return { posted: result.count, period };
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
