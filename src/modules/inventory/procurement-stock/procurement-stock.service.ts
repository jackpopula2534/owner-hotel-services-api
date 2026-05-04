import { Injectable, Logger } from '@nestjs/common';
import { Prisma, InventoryLotStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { QueryStockBalanceDto, StockBalanceFilter } from './dto/query-balance.dto';
import { QueryLotExpiringDto, LotExpiryFilter } from './dto/query-expiring.dto';

/**
 * Sprint 3 — read-only procurement view of warehouse state.
 *
 * The warehouse module already owns stock/lot writes. This service is a
 * specialized read aggregator for the procurement role: it joins
 * `WarehouseStock` + `InventoryItem` (+ open POs + preferred supplier) into
 * the rows the buyer needs to make decisions — order more, hold off, return.
 *
 * Status classification rules (single source of truth, used by both
 * `findBalance` and `getSummary`):
 *
 *   OUT_OF_STOCK : quantity <= 0
 *   LOW          : quantity > 0  AND  quantity <= effectiveReorderPoint
 *   OVERSTOCK    : maxStock != null AND quantity > maxStock
 *   OK           : otherwise
 *
 * "effectiveReorderPoint" = reorderPoint (if > 0) else minStock.
 */
@Injectable()
export class ProcurementStockService {
  private readonly logger = new Logger(ProcurementStockService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Balance ──────────────────────────────────────────────────────────────

  async findBalance(tenantId: string, query: QueryStockBalanceDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const filter = query.filter ?? StockBalanceFilter.ALL;

    // Pull everything matching the warehouse/category/search constraints. We
    // classify in-memory because the LOW/OVERSTOCK predicate is a comparison
    // between two columns on the SAME row (quantity vs item.reorderPoint /
    // item.maxStock) which Prisma can't express directly without raw SQL —
    // the in-memory hop is cheap given the typical SKU count per tenant.
    const stocks = await this.prisma.warehouseStock.findMany({
      where: {
        warehouse: { tenantId, deletedAt: null },
        ...(query.warehouseId && { warehouseId: query.warehouseId }),
        item: {
          tenantId,
          isActive: true,
          deletedAt: null,
          ...(query.categoryId && { categoryId: query.categoryId }),
          ...(query.search && {
            OR: [{ sku: { contains: query.search } }, { name: { contains: query.search } }],
          }),
        },
      },
      select: {
        warehouseId: true,
        itemId: true,
        quantity: true,
        avgCost: true,
        totalValue: true,
        warehouse: { select: { id: true, name: true } },
        item: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            reorderPoint: true,
            reorderQty: true,
            minStock: true,
            maxStock: true,
            isPerishable: true,
            categoryId: true,
            category: { select: { name: true } },
            itemSuppliers: {
              where: { isPreferred: true },
              orderBy: { lastOrderDate: 'desc' },
              take: 1,
              select: {
                supplierId: true,
                unitPrice: true,
                leadDays: true,
                supplier: { select: { id: true, name: true, leadTimeDays: true } },
              },
            },
          },
        },
      },
    });

    // For the "PO ค้าง" column we want to know if this item has an open
    // (APPROVED or PARTIAL) PO already coming in — keeps the buyer from
    // double-ordering. Single batched query keyed by itemId.
    const itemIds = Array.from(new Set(stocks.map((s) => s.itemId)));
    const openPoItems = itemIds.length
      ? await this.prisma.purchaseOrderItem.findMany({
          where: {
            itemId: { in: itemIds },
            purchaseOrder: {
              tenantId,
              status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
            },
          },
          select: {
            itemId: true,
            quantity: true,
            receivedQty: true,
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
                expectedDate: true,
                warehouseId: true,
              },
            },
          },
        })
      : [];

    // Group by `${itemId}:${warehouseId}` so an open PO only counts toward
    // the warehouse it's destined for.
    const openPoByItemWh = new Map<
      string,
      { pendingQty: number; po: { id: string; poNumber: string; expectedDate: Date | null } }
    >();
    for (const poi of openPoItems) {
      const key = `${poi.itemId}:${poi.purchaseOrder.warehouseId}`;
      const pending = Math.max(0, (poi.quantity ?? 0) - (poi.receivedQty ?? 0));
      const existing = openPoByItemWh.get(key);
      if (!existing) {
        openPoByItemWh.set(key, {
          pendingQty: pending,
          po: {
            id: poi.purchaseOrder.id,
            poNumber: poi.purchaseOrder.poNumber,
            expectedDate: poi.purchaseOrder.expectedDate,
          },
        });
      } else {
        existing.pendingQty += pending;
      }
    }

    // Classify + shape rows
    const allRows = stocks.map((s) => {
      const status = this.classify(s.quantity, {
        reorderPoint: s.item.reorderPoint,
        minStock: s.item.minStock,
        maxStock: s.item.maxStock ?? null,
      });
      const preferred = s.item.itemSuppliers[0] ?? null;
      const openPoKey = `${s.itemId}:${s.warehouseId}`;
      const openPo = openPoByItemWh.get(openPoKey) ?? null;

      return {
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse?.name ?? 'Unknown',
        itemId: s.itemId,
        sku: s.item.sku,
        name: s.item.name,
        unit: s.item.unit,
        categoryId: s.item.categoryId,
        categoryName: s.item.category?.name ?? null,
        quantity: s.quantity,
        avgCost: Number(s.avgCost),
        totalValue: Number(s.totalValue),
        reorderPoint: s.item.reorderPoint,
        reorderQty: s.item.reorderQty,
        minStock: s.item.minStock,
        maxStock: s.item.maxStock ?? null,
        isPerishable: s.item.isPerishable,
        status,
        // The deficit / excess tells the buyer "how much" not just "above/below".
        deficit:
          status === 'LOW' || status === 'OUT_OF_STOCK'
            ? Math.max(0, this.effectiveReorderPoint(s.item) - s.quantity)
            : 0,
        excess:
          status === 'OVERSTOCK' && s.item.maxStock != null
            ? Math.max(0, s.quantity - s.item.maxStock)
            : 0,
        preferredSupplier: preferred
          ? {
              id: preferred.supplierId,
              name: preferred.supplier?.name ?? 'Unknown',
              leadDays: preferred.leadDays ?? preferred.supplier?.leadTimeDays ?? null,
              unitPrice: Number(preferred.unitPrice),
            }
          : null,
        openPo: openPo
          ? {
              id: openPo.po.id,
              poNumber: openPo.po.poNumber,
              expectedDate: openPo.po.expectedDate,
              pendingQty: openPo.pendingQty,
            }
          : null,
      };
    });

    // Apply filter AFTER classification so summary counts stay consistent
    let filtered = allRows;
    if (filter !== StockBalanceFilter.ALL) {
      filtered = allRows.filter((r) => r.status === filter);
    }

    // Sort: most-urgent first within each filter. For LOW / OUT_OF_STOCK we
    // surface the biggest deficit first; for OVERSTOCK the biggest excess.
    filtered.sort((a, b) => {
      if (a.status === 'OUT_OF_STOCK' && b.status !== 'OUT_OF_STOCK') return -1;
      if (b.status === 'OUT_OF_STOCK' && a.status !== 'OUT_OF_STOCK') return 1;
      if (a.deficit !== b.deficit) return b.deficit - a.deficit;
      if (a.excess !== b.excess) return b.excess - a.excess;
      return a.name.localeCompare(b.name, 'th');
    });

    const total = filtered.length;
    const data = filtered.slice(skip, skip + limit);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        // Carry the unfiltered classification counts so the tab badges
        // can show "ALL: 847 · LOW: 23 · OVERSTOCK: 8" without a 2nd round-trip.
        breakdown: this.countByStatus(allRows),
      },
    };
  }

  // ─── Expiring lots ────────────────────────────────────────────────────────

  async findExpiring(tenantId: string, query: QueryLotExpiringDto) {
    const days = query.days ?? 30;
    const filter = query.filter ?? LotExpiryFilter.NEAR;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const future = new Date(today);
    future.setDate(today.getDate() + days);

    const dateClause: Prisma.InventoryLotWhereInput =
      filter === LotExpiryFilter.NEAR
        ? { expiryDate: { gte: today, lte: future } }
        : filter === LotExpiryFilter.EXPIRED
          ? { expiryDate: { lt: today } }
          : { expiryDate: { lte: future } }; // BOTH

    const lots = await this.prisma.inventoryLot.findMany({
      where: {
        tenantId,
        // Only show lots that still have stock left — fully-consumed expired
        // lots are noise to the buyer.
        remainingQty: { gt: 0 },
        status: {
          in: [
            InventoryLotStatus.ACTIVE,
            InventoryLotStatus.QUARANTINED,
            // EXPIRED status lots are explicitly visible in the EXPIRED tab
            ...(filter !== LotExpiryFilter.NEAR ? [InventoryLotStatus.EXPIRED] : []),
          ],
        },
        ...(query.warehouseId && { warehouseId: query.warehouseId }),
        ...dateClause,
      },
      orderBy: { expiryDate: 'asc' },
      include: {
        item: { select: { id: true, sku: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    return lots.map((lot) => {
      const daysLeft = lot.expiryDate
        ? Math.floor((lot.expiryDate.getTime() - today.getTime()) / 86_400_000)
        : null;
      const isExpired = daysLeft != null && daysLeft < 0;

      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        batchNumber: lot.batchNumber,
        itemId: lot.itemId,
        sku: lot.item?.sku ?? null,
        name: lot.item?.name ?? null,
        unit: lot.item?.unit ?? null,
        warehouseId: lot.warehouseId,
        warehouseName: lot.warehouse?.name ?? 'Unknown',
        remainingQty: lot.remainingQty,
        unitCost: Number(lot.unitCost),
        value: Number(lot.unitCost) * lot.remainingQty,
        expiryDate: lot.expiryDate,
        daysLeft,
        status: isExpired ? 'EXPIRED' : 'NEAR',
        receivedDate: lot.receivedDate,
      };
    });
  }

  // ─── Summary (KPI cards) ──────────────────────────────────────────────────

  async getSummary(tenantId: string, warehouseId?: string) {
    // Reuse findBalance with an empty filter so the breakdown reflects the
    // exact same classification rules. We discard `data` — only `breakdown`
    // matters here.
    const balance = await this.findBalance(tenantId, {
      filter: StockBalanceFilter.ALL,
      warehouseId,
      page: 1,
      limit: 1, // small page — we just want the counts
    });

    // Lot counts: both NEAR and EXPIRED
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next30 = new Date(today);
    next30.setDate(today.getDate() + 30);

    // Distinct item count for the "รวมสินค้า" KPI. We count InventoryItem rows
    // directly (NOT the sum of breakdown buckets) because breakdown counts are
    // keyed by `(itemId, warehouseId)` — an item that lives in two warehouses
    // would be double-counted there. The dashboard headline number must match
    // what the รายการสินค้า list page shows, which queries InventoryItem.
    const [nearExpiry, expired, totalStockValue, totalItems] = await Promise.all([
      this.prisma.inventoryLot.count({
        where: {
          tenantId,
          remainingQty: { gt: 0 },
          status: { in: [InventoryLotStatus.ACTIVE, InventoryLotStatus.QUARANTINED] },
          expiryDate: { gte: today, lte: next30 },
          ...(warehouseId && { warehouseId }),
        },
      }),
      this.prisma.inventoryLot.count({
        where: {
          tenantId,
          remainingQty: { gt: 0 },
          status: {
            in: [
              InventoryLotStatus.ACTIVE,
              InventoryLotStatus.QUARANTINED,
              InventoryLotStatus.EXPIRED,
            ],
          },
          expiryDate: { lt: today },
          ...(warehouseId && { warehouseId }),
        },
      }),
      this.prisma.warehouseStock.aggregate({
        where: {
          warehouse: { tenantId, deletedAt: null },
          ...(warehouseId && { warehouseId }),
        },
        _sum: { totalValue: true },
      }),
      // Distinct active item count. When a warehouseId filter is provided we
      // narrow to items that have stock in that specific warehouse so the KPI
      // is consistent with the rest of the per-warehouse summary numbers.
      warehouseId
        ? this.prisma.inventoryItem
            .findMany({
              where: {
                tenantId,
                isActive: true,
                deletedAt: null,
                warehouseStocks: { some: { warehouseId } },
              },
              select: { id: true },
            })
            .then((rows) => rows.length)
        : this.prisma.inventoryItem.count({
            where: { tenantId, isActive: true, deletedAt: null },
          }),
    ]);

    return {
      totalItems,
      lowCount: balance.meta.breakdown.LOW,
      outOfStockCount: balance.meta.breakdown.OUT_OF_STOCK,
      overstockCount: balance.meta.breakdown.OVERSTOCK,
      okCount: balance.meta.breakdown.OK,
      nearExpiryCount: nearExpiry,
      expiredCount: expired,
      totalStockValue: Number(totalStockValue._sum.totalValue ?? 0),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private effectiveReorderPoint(item: { reorderPoint: number; minStock: number }): number {
    // Falls back to minStock when reorderPoint is unset (= 0). Tenants tend
    // to fill in only one of the two and we want the report to surface
    // alerts in both cases.
    return item.reorderPoint > 0 ? item.reorderPoint : item.minStock;
  }

  private classify(
    quantity: number,
    item: { reorderPoint: number; minStock: number; maxStock: number | null },
  ): 'OK' | 'LOW' | 'OUT_OF_STOCK' | 'OVERSTOCK' {
    if (quantity <= 0) return 'OUT_OF_STOCK';
    if (item.maxStock != null && quantity > item.maxStock) return 'OVERSTOCK';
    const rp = this.effectiveReorderPoint(item);
    if (rp > 0 && quantity <= rp) return 'LOW';
    return 'OK';
  }

  private countByStatus(rows: Array<{ status: string }>) {
    const counts = { OK: 0, LOW: 0, OUT_OF_STOCK: 0, OVERSTOCK: 0 };
    for (const r of rows) {
      counts[r.status as keyof typeof counts]++;
    }
    return counts;
  }
}
