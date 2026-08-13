import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Where a price guess came from. Kept on the document so a purchaser can see
 * whether they are looking at a supplier's own list price or something the
 * system inferred from our own books.
 */
export type PriceEstimateSource =
  | 'SUPPLIER_PREFERRED'
  | 'LAST_PURCHASE'
  | 'SUPPLIER'
  | 'STOCK_AVG';

export interface ItemPriceEstimate {
  unitPrice: number;
  source: PriceEstimateSource;
  /** Set only when the price came from a supplier price list. */
  supplierId: string | null;
}

/** Thai labels stamped onto the PR line so the origin survives into the UI. */
export const PRICE_SOURCE_LABEL: Record<PriceEstimateSource, string> = {
  SUPPLIER_PREFERRED: 'ราคาประมาณการจากผู้ขายหลัก',
  LAST_PURCHASE: 'ราคาประมาณการจากใบสั่งซื้อล่าสุด',
  SUPPLIER: 'ราคาประมาณการจากรายการราคาผู้ขาย',
  STOCK_AVG: 'ราคาประมาณการจากต้นทุนเฉลี่ยในคลัง',
};

/**
 * Guesses a unit price for inventory items that are about to be requested.
 *
 * A purchase requisition with no price at all is not harmless: it reads as
 * "free" on every screen that totals it, and it gives an approver nothing to
 * approve against. The real price still arrives later from the supplier quote —
 * this only fills the gap between raising the request and receiving that quote.
 *
 * Nothing here invents a number. When we have never bought the item, never
 * stocked it and no supplier lists it, the item is left without an estimate
 * rather than being priced at zero.
 */
@Injectable()
export class ItemPriceEstimateService {
  private readonly logger = new Logger(ItemPriceEstimateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an estimate per item, cheapest source of truth first. Every step
   * is a single batched query, so the cost does not grow with the line count.
   */
  async estimateMany(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, ItemPriceEstimate>> {
    const found = new Map<string, ItemPriceEstimate>();
    const ids = [...new Set(itemIds)];
    if (ids.length === 0) return found;

    await this.fromSupplierList(tenantId, ids, found);
    await this.fromLastPurchase(tenantId, this.pending(ids, found), found);
    await this.fromStockValue(tenantId, this.pending(ids, found), found);

    const missing = this.pending(ids, found).length;
    if (missing > 0) {
      this.logger.warn(
        `No price reference for ${missing}/${ids.length} item(s) — ` +
          'the requisition lines will be raised without an estimate',
      );
    }
    return found;
  }

  private pending(ids: string[], found: Map<string, ItemPriceEstimate>): string[] {
    return ids.filter((id) => !found.has(id));
  }

  /**
   * Supplier price lists. The preferred supplier wins; otherwise the cheapest
   * listing, because that is the number a buyer would chase first.
   */
  private async fromSupplierList(
    tenantId: string,
    ids: string[],
    found: Map<string, ItemPriceEstimate>,
  ): Promise<void> {
    const rows = await this.prisma.itemSupplier.findMany({
      where: {
        itemId: { in: ids },
        item: { tenantId, deletedAt: null },
        supplier: { tenantId, isActive: true, deletedAt: null },
        unitPrice: { gt: 0 },
      },
      select: { itemId: true, supplierId: true, unitPrice: true, isPreferred: true },
      orderBy: [{ isPreferred: 'desc' }, { unitPrice: 'asc' }],
    });

    for (const row of rows) {
      if (found.has(row.itemId)) continue; // first row per item is the best one
      found.set(row.itemId, {
        unitPrice: Number(row.unitPrice),
        source: row.isPreferred ? 'SUPPLIER_PREFERRED' : 'SUPPLIER',
        supplierId: row.supplierId,
      });
    }
  }

  /**
   * What we actually paid last time. Two queries rather than a `distinct`, so
   * the result set stays bounded no matter how long the order history is.
   */
  private async fromLastPurchase(
    tenantId: string,
    ids: string[],
    found: Map<string, ItemPriceEstimate>,
  ): Promise<void> {
    if (ids.length === 0) return;

    const latest = await this.prisma.purchaseOrderItem.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: ids },
        unitPrice: { gt: 0 },
        purchaseOrder: { tenantId, status: { not: 'CANCELLED' } },
      },
      _max: { createdAt: true },
    });
    const pairs = latest
      .filter((row) => row._max.createdAt !== null)
      .map((row) => ({ itemId: row.itemId, createdAt: row._max.createdAt as Date }));
    if (pairs.length === 0) return;

    const rows = await this.prisma.purchaseOrderItem.findMany({
      where: { OR: pairs },
      select: { itemId: true, unitPrice: true },
    });
    for (const row of rows) {
      if (found.has(row.itemId)) continue;
      found.set(row.itemId, {
        unitPrice: Number(row.unitPrice),
        source: 'LAST_PURCHASE',
        supplierId: null,
      });
    }
  }

  /**
   * Weighted average cost of stock on hand — value over quantity across every
   * warehouse, not an average of averages, which would over-weight the smallest
   * pile.
   */
  private async fromStockValue(
    tenantId: string,
    ids: string[],
    found: Map<string, ItemPriceEstimate>,
  ): Promise<void> {
    if (ids.length === 0) return;

    const rows = await this.prisma.warehouseStock.groupBy({
      by: ['itemId'],
      where: {
        itemId: { in: ids },
        quantity: { gt: 0 },
        warehouse: { tenantId },
      },
      _sum: { quantity: true, totalValue: true },
    });

    for (const row of rows) {
      const qty = Number(row._sum.quantity ?? 0);
      const value = Number(row._sum.totalValue ?? 0);
      if (qty <= 0 || value <= 0) continue;
      found.set(row.itemId, {
        unitPrice: Math.round((value / qty) * 100) / 100,
        source: 'STOCK_AVG',
        supplierId: null,
      });
    }
  }
}
