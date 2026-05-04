import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  calculatePurchaseOrderTotals,
  CalculationBreakdown,
  DiscountMode,
  DiscountType,
  LineBreakdown,
} from '@/common/purchase-order/po-calculation';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto, PurchaseOrderStatus } from './dto/query-purchase-order.dto';
import {
  QueryPurchaseOrderTrackingDto,
  PurchaseOrderTrackingStatus,
} from './dto/query-purchase-order-tracking.dto';

/**
 * Shape of a single row in the procurement Receiving Pipeline view.
 * Computed from PurchaseOrder + items + latest GoodsReceive — no schema additions
 * required (receivedQty already lives on PurchaseOrderItem).
 */
export interface PurchaseOrderTrackingRow {
  id: string;
  poNumber: string;
  status: string;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  expectedDate: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  totalAmount: number;
  currency: string;
  isOverdue: boolean;
  daysOverdue: number;
  progress: {
    orderedQty: number;
    receivedQty: number;
    pendingQty: number;
    percent: number;
    lineCount: number;
    receivedLineCount: number;
    pendingLineCount: number;
  };
  latestGr: {
    id: string;
    grNumber: string;
    status: string;
    receiveDate: Date;
  } | null;
}

export interface PurchaseOrderTrackingSummary {
  approvedAwaiting: number;
  partial: number;
  full: number;
  closed: number;
  overdue: number;
  totalValue: number;
  pendingValue: number;
}

/**
 * Sprint 2 — line-level reconciliation between PO and its linked GRs.
 * Surfaces ordered/received/pending per line plus the GR breakdown,
 * which the procurement-side PO detail "การรับเข้า" tab consumes.
 */
export interface PurchaseOrderReceivingLine {
  poItemId: string;
  itemId: string;
  sku: string | null;
  name: string | null;
  unit: string | null;
  ordered: number;
  received: number;
  pending: number;
  percent: number;
  status: 'PENDING' | 'PARTIAL' | 'FULL' | 'OVER';
  // Most-recent GR row that touched this line, if any
  lastGr: {
    grId: string;
    grNumber: string;
    receivedQty: number;
    rejectedQty: number;
    receiveDate: Date;
    lotId: string | null;
    expiryDate: Date | null;
  } | null;
}

export interface PurchaseOrderReceivingGrSummary {
  id: string;
  grNumber: string;
  status: string;
  receiveDate: Date;
  invoiceNumber: string | null;
  totalAmount: number;
  itemCount: number;
}

/**
 * Sprint 4 — variance row for the procurement Variance Report.
 *
 * Each row reflects a 3-way snapshot of a single PO:
 *   ordered  — sum of PurchaseOrderItem.quantity
 *   received — sum of PurchaseOrderItem.receivedQty (rolled up by GR)
 *   invoiced — sum of GoodsReceiveItem.receivedQty on GRs that have an invoice
 *               (proxy until we have a full invoicing module)
 *
 *   deltaQty     = received - ordered     (negative when short, positive when over)
 *   deltaAmount  = pro-rated value of deltaQty
 *   reason       = derived from PO state (overdue, force-closed, accepted-over)
 */
export interface PurchaseOrderVarianceRow {
  poId: string;
  poNumber: string;
  supplier: { id: string; name: string };
  status: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: number;
  deltaQty: number;
  deltaAmount: number;
  invoicedAmount: number;
  expectedDate: Date | null;
  forceClosedAt: Date | null;
  forceClosedReason: string | null;
  reason:
    | 'SHORT_DELIVERY'
    | 'OVER_DELIVERY'
    | 'INVOICE_MISMATCH'
    | 'OVERDUE'
    | 'FORCE_CLOSED'
    | 'NONE';
  suggestedAction: string;
}

export interface PurchaseOrderReceivingDetail {
  purchaseOrderId: string;
  poNumber: string;
  status: string;
  totals: {
    orderedQty: number;
    receivedQty: number;
    pendingQty: number;
    percent: number;
    orderedValue: number;
    receivedValue: number;
    pendingValue: number;
  };
  lines: PurchaseOrderReceivingLine[];
  grs: PurchaseOrderReceivingGrSummary[];
}

type PurchaseOrderItemInput = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  discountType?: DiscountType;
  taxRate?: number;
  notes?: string;
};

/**
 * Row shape of a persisted PurchaseOrder after the 20260417 migration adds
 * `discountMode`, `headerDiscount`, `headerDiscountType`, and
 * `calculationBreakdown`. Used by this service to read the new columns
 * without waiting for a local `prisma generate` — the runtime client
 * returns them as soon as the migration is applied.
 */
type PurchaseOrderWithDiscount = Prisma.PurchaseOrderGetPayload<Record<string, never>> & {
  discountMode: DiscountMode;
  headerDiscount: Prisma.Decimal | number | null;
  headerDiscountType: DiscountType;
  calculationBreakdown: Prisma.JsonValue | null;
};

/**
 * Row shape of a PurchaseOrderItem after the migration adds `discountType`.
 */
type PurchaseOrderItemWithDiscountType = Prisma.PurchaseOrderItemGetPayload<
  Record<string, never>
> & {
  discountType: DiscountType;
};

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve user UUIDs to full names (firstName + lastName).
   * Returns a Map<userId, fullName>.
   */
  private async resolveUserNames(
    userIds: (string | null | undefined)[],
  ): Promise<Map<string, string>> {
    const validIds = userIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return new Map();

    const users = await this.prisma.user.findMany({
      where: { id: { in: validIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const map = new Map<string, string>();
    for (const user of users) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
      map.set(user.id, fullName);
    }
    return map;
  }

  /**
   * Compute totals + breakdown from a DTO's items + header discount.
   * Shared helper used by create() and update() so the math lives
   * in exactly one place.
   */
  private computeTotals(
    items: PurchaseOrderItemInput[],
    headerDiscount: number,
    headerDiscountType: DiscountType,
    discountMode: DiscountMode,
  ): CalculationBreakdown {
    return calculatePurchaseOrderTotals({
      discountMode,
      headerDiscount: {
        value: headerDiscount,
        type: headerDiscountType,
      },
      lines: items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountValue: item.discount ?? 0,
        discountType: item.discountType ?? 'PERCENT',
        taxRate: item.taxRate ?? 0,
      })),
    });
  }

  async findAll(
    tenantId: string,
    query: QueryPurchaseOrderDto,
  ): Promise<{
    data: Array<{
      id: string;
      poNumber: string;
      status: string;
      supplierId: string;
      supplierName: string;
      propertyId: string;
      warehouseId: string;
      expectedDate: Date | null;
      createdAt: Date;
      totalAmount: Prisma.Decimal;
      itemCount: number;
    }>;
    meta: { page: number; limit: number; total: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.status && { status: query.status }),
      ...(query.startDate && {
        createdAt: { gte: new Date(query.startDate) },
      }),
      ...(query.endDate && {
        createdAt: { lte: new Date(query.endDate) },
      }),
      ...(query.search && {
        poNumber: { contains: query.search },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          poNumber: true,
          status: true,
          supplierId: true,
          supplier: {
            select: { name: true },
          },
          propertyId: true,
          warehouseId: true,
          expectedDate: true,
          createdAt: true,
          totalAmount: true,
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: data.map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplierId: po.supplierId,
        supplierName: po.supplier?.name || 'Unknown',
        propertyId: po.propertyId,
        warehouseId: po.warehouseId,
        expectedDate: po.expectedDate,
        createdAt: po.createdAt,
        totalAmount: po.totalAmount,
        itemCount: po._count.items,
      })),
      meta: { page, limit, total },
    };
  }

  /**
   * Receiving pipeline view — list POs that are post-approval together with
   * received-vs-ordered roll-ups, days overdue, and the latest GR linked to
   * each PO. Used by the procurement-side "PO Tracking" page (Sprint 1).
   *
   * Reuses existing `PurchaseOrderItem.receivedQty` and `PurchaseOrder.expectedDate`;
   * no schema additions required.
   */
  async findTracking(
    tenantId: string,
    query: QueryPurchaseOrderTrackingDto,
  ): Promise<{
    data: PurchaseOrderTrackingRow[];
    meta: {
      page: number;
      limit: number;
      total: number;
      summary: PurchaseOrderTrackingSummary;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Default scope: only post-approval POs are meaningful for "tracking".
    const trackingStatuses: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.FULLY_RECEIVED,
      PurchaseOrderStatus.CLOSED,
    ];

    const statusFilter: PurchaseOrderStatus[] = query.status
      ? [query.status as unknown as PurchaseOrderStatus]
      : trackingStatuses;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      status: { in: statusFilter },
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.warehouseId && { warehouseId: query.warehouseId }),
      ...(query.search && { poNumber: { contains: query.search } }),
      ...(query.overdue && {
        expectedDate: { lt: today },
        status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ expectedDate: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          poNumber: true,
          status: true,
          expectedDate: true,
          approvedAt: true,
          createdAt: true,
          totalAmount: true,
          currency: true,
          supplierId: true,
          warehouseId: true,
          supplier: { select: { name: true } },
          items: {
            select: { quantity: true, receivedQty: true },
          },
          goodsReceives: {
            select: { id: true, grNumber: true, status: true, receiveDate: true },
            orderBy: { receiveDate: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    // Resolve warehouse names in one round-trip — selecting via Prisma include
    // would couple us to the Warehouse model and be wasteful for the column we need.
    const warehouseIds = Array.from(new Set(rows.map((r) => r.warehouseId)));
    const warehouses = warehouseIds.length
      ? await this.prisma.warehouse.findMany({
          where: { id: { in: warehouseIds } },
          select: { id: true, name: true },
        })
      : [];
    const warehouseMap = new Map(warehouses.map((w) => [w.id, w.name]));

    const data: PurchaseOrderTrackingRow[] = rows.map((po) => {
      const orderedQty = po.items.reduce((sum, it) => sum + (it.quantity ?? 0), 0);
      const receivedQty = po.items.reduce((sum, it) => sum + (it.receivedQty ?? 0), 0);
      const pendingQty = Math.max(0, orderedQty - receivedQty);
      const percent = orderedQty > 0 ? Math.round((receivedQty / orderedQty) * 100) : 0;
      const receivedLineCount = po.items.filter(
        (it) => (it.receivedQty ?? 0) >= (it.quantity ?? 0),
      ).length;
      const pendingLineCount = po.items.length - receivedLineCount;

      const isPostFull =
        po.status === PurchaseOrderStatus.FULLY_RECEIVED ||
        po.status === PurchaseOrderStatus.CLOSED;
      const isOverdue = !isPostFull && !!po.expectedDate && po.expectedDate < today;
      const daysOverdue = isOverdue
        ? Math.floor((today.getTime() - po.expectedDate!.getTime()) / 86_400_000)
        : 0;

      const gr = po.goodsReceives[0] ?? null;

      return {
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        supplier: { id: po.supplierId, name: po.supplier?.name ?? 'Unknown' },
        warehouse: {
          id: po.warehouseId,
          name: warehouseMap.get(po.warehouseId) ?? 'Unknown',
        },
        expectedDate: po.expectedDate,
        approvedAt: po.approvedAt,
        createdAt: po.createdAt,
        totalAmount: Number(po.totalAmount),
        currency: po.currency,
        isOverdue,
        daysOverdue,
        progress: {
          orderedQty,
          receivedQty,
          pendingQty,
          percent,
          lineCount: po.items.length,
          receivedLineCount,
          pendingLineCount,
        },
        latestGr: gr
          ? {
              id: gr.id,
              grNumber: gr.grNumber,
              status: gr.status,
              receiveDate: gr.receiveDate,
            }
          : null,
      };
    });

    // Summary aggregated server-side over the full filtered set (not just current page)
    const summary = await this.computeTrackingSummary(tenantId, query, today);

    return {
      data,
      meta: { page, limit, total, summary },
    };
  }

  /**
   * Aggregate counts & values across the full filtered set so KPI cards on the
   * tracking page reflect totals, not just the current page.
   */
  private async computeTrackingSummary(
    tenantId: string,
    query: QueryPurchaseOrderTrackingDto,
    today: Date,
  ): Promise<PurchaseOrderTrackingSummary> {
    const baseWhere: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.warehouseId && { warehouseId: query.warehouseId }),
      ...(query.search && { poNumber: { contains: query.search } }),
    };

    const [approvedRows, partialRows, fullCount, closedCount, overdueCount] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { ...baseWhere, status: PurchaseOrderStatus.APPROVED },
        select: { totalAmount: true, items: { select: { quantity: true, receivedQty: true } } },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { ...baseWhere, status: PurchaseOrderStatus.PARTIALLY_RECEIVED },
        select: { totalAmount: true, items: { select: { quantity: true, receivedQty: true } } },
      }),
      this.prisma.purchaseOrder.count({
        where: { ...baseWhere, status: PurchaseOrderStatus.FULLY_RECEIVED },
      }),
      this.prisma.purchaseOrder.count({
        where: { ...baseWhere, status: PurchaseOrderStatus.CLOSED },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...baseWhere,
          expectedDate: { lt: today },
          status: {
            in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED],
          },
        },
      }),
    ]);

    const sumValue = (rows: typeof approvedRows): number =>
      rows.reduce((s, r) => s + Number(r.totalAmount), 0);

    // Pending value = portion of partial+approved orders not yet received,
    // calculated proportionally so a 60% received order contributes 40% of value.
    const pendingValueOf = (rows: typeof approvedRows): number =>
      rows.reduce((sum, po) => {
        const ordered = po.items.reduce((s, it) => s + (it.quantity ?? 0), 0);
        const received = po.items.reduce((s, it) => s + (it.receivedQty ?? 0), 0);
        const remainingPct = ordered > 0 ? Math.max(0, ordered - received) / ordered : 0;
        return sum + Number(po.totalAmount) * remainingPct;
      }, 0);

    return {
      approvedAwaiting: approvedRows.length,
      partial: partialRows.length,
      full: fullCount,
      closed: closedCount,
      overdue: overdueCount,
      totalValue: sumValue(approvedRows) + sumValue(partialRows),
      pendingValue: pendingValueOf(approvedRows) + pendingValueOf(partialRows),
    };
  }

  /**
   * Sprint 4 — Variance report for procurement-side reconciliation.
   *
   * Returns one row per PO in the [from, to] window where there's a meaningful
   * delta (qty differs from ordered, or PO is overdue/force-closed).
   * Rows with `reason: 'NONE'` are excluded from the response.
   */
  async findVariance(
    tenantId: string,
    query: { from?: string; to?: string; supplierId?: string },
  ): Promise<{
    data: PurchaseOrderVarianceRow[];
    meta: { total: number; netDeltaAmount: number };
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      // Variance only makes sense for POs that actually entered the receiving
      // pipeline — DRAFT/PENDING/CANCELLED don't have GRs.
      status: {
        in: [
          PurchaseOrderStatus.APPROVED,
          PurchaseOrderStatus.PARTIALLY_RECEIVED,
          PurchaseOrderStatus.FULLY_RECEIVED,
          PurchaseOrderStatus.CLOSED,
        ],
      },
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.from && { createdAt: { gte: new Date(query.from) } }),
      ...(query.to && { createdAt: { lte: new Date(query.to) } }),
    };

    const pos = await this.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        poNumber: true,
        status: true,
        totalAmount: true,
        expectedDate: true,
        supplierId: true,
        supplier: { select: { name: true } },
        items: { select: { quantity: true, receivedQty: true, totalPrice: true } },
        goodsReceives: {
          select: {
            invoiceNumber: true,
            items: { select: { receivedQty: true, totalCost: true } },
          },
        },
      },
    });

    const poRaw = pos as unknown as Array<
      (typeof pos)[number] & { forceClosedAt: Date | null; forceClosedReason: string | null }
    >;

    const rows: PurchaseOrderVarianceRow[] = [];
    let netDeltaAmount = 0;

    for (const po of poRaw) {
      const orderedQty = po.items.reduce((s, i) => s + (i.quantity ?? 0), 0);
      const receivedQty = po.items.reduce((s, i) => s + (i.receivedQty ?? 0), 0);

      // Invoiced qty/amount: only count GRs that have an invoiceNumber.
      // Until we have a real invoicing table, this is a useful proxy because
      // accounting only enters an invoice number once they've matched it.
      let invoicedQty = 0;
      let invoicedAmount = 0;
      for (const gr of po.goodsReceives) {
        if (!gr.invoiceNumber) continue;
        for (const it of gr.items) {
          invoicedQty += it.receivedQty ?? 0;
          invoicedAmount += Number(it.totalCost ?? 0);
        }
      }

      const deltaQty = receivedQty - orderedQty;

      // Pro-rate delta value off the PO total — keeps the figure sensitive
      // to discounts and tax that are baked into totalAmount.
      const deltaAmount = orderedQty > 0 ? (Number(po.totalAmount) / orderedQty) * deltaQty : 0;

      let reason: PurchaseOrderVarianceRow['reason'] = 'NONE';
      let suggestedAction = '';

      if (po.forceClosedAt) {
        reason = 'FORCE_CLOSED';
        suggestedAction = 'เคลม supplier / ปรับงบ';
      } else if (deltaQty > 0) {
        reason = 'OVER_DELIVERY';
        suggestedAction = 'รับเกิน → คืน หรือเพิ่ม PO line';
      } else if (deltaQty < 0 && po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
        // Overdue partial → mark separately so UI can highlight
        if (po.expectedDate && po.expectedDate < today) {
          reason = 'OVERDUE';
          suggestedAction = 'ติดตามซัพ / Force close';
        } else {
          reason = 'SHORT_DELIVERY';
          suggestedAction = 'ติดตามซัพ';
        }
      } else if (invoicedQty !== 0 && invoicedQty !== receivedQty) {
        reason = 'INVOICE_MISMATCH';
        suggestedAction = 'โต้แย้ง invoice';
      }

      // Skip rows with no actionable variance — pure FULLY_RECEIVED+matched POs
      // would otherwise drown out the report.
      if (reason === 'NONE') continue;

      netDeltaAmount += deltaAmount;

      rows.push({
        poId: po.id,
        poNumber: po.poNumber,
        supplier: { id: po.supplierId, name: po.supplier?.name ?? 'Unknown' },
        status: po.status,
        orderedQty,
        receivedQty,
        invoicedQty,
        deltaQty,
        deltaAmount,
        invoicedAmount,
        expectedDate: po.expectedDate,
        forceClosedAt: po.forceClosedAt,
        forceClosedReason: po.forceClosedReason,
        reason,
        suggestedAction,
      });
    }

    return { data: rows, meta: { total: rows.length, netDeltaAmount } };
  }

  /**
   * Sprint 5 — Procurement dashboard spend summary.
   *
   * Powers the SpendCard on /purchasing (DashboardV2 + V1 ManagerView).
   * Surfaces:
   *   - thisMonth / lastMonth committed spend
   *   - deltaPct (null when lastMonth = 0 to avoid /0)
   *   - 12-month sparkline trend, oldest → newest
   *   - top-N category breakdown with "อื่น ๆ" lump for the tail
   *
   * "Committed spend" = totalAmount of POs that have been approved or
   * received (APPROVED / PARTIALLY_RECEIVED / FULLY_RECEIVED / CLOSED).
   * DRAFT / PENDING_APPROVAL / CANCELLED are excluded so the figure
   * reflects money actually allocated, not requested-but-unsigned.
   *
   * Trend is bucketed by `approvedAt` when present (so an old draft
   * approved late lands in the right month) and falls back to `createdAt`
   * for legacy rows that pre-date the approvedAt column.
   */
  async findSpendSummary(
    tenantId: string,
    propertyId?: string,
  ): Promise<{
    thisMonth: number;
    lastMonth: number;
    deltaPct: number | null;
    trend: number[];
    categories: Array<{
      categoryId: string | null;
      categoryName: string;
      total: number;
      pct: number;
    }>;
  }> {
    const committedStatuses: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.FULLY_RECEIVED,
      PurchaseOrderStatus.CLOSED,
    ];

    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1); // exclusive
    // 12-month window starts at the first day of (now - 11 months).
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const baseWhere: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      status: { in: committedStatuses },
      ...(propertyId && { propertyId }),
    };

    // One sweep covering the longest window we need (12 months back) — we then
    // partition in-memory rather than running 14+ separate queries. Selecting
    // `items.totalPrice` and the joined item.categoryId/category.name lets us
    // compute category breakdown without a 2nd round-trip.
    const pos = await this.prisma.purchaseOrder.findMany({
      where: {
        ...baseWhere,
        OR: [
          { approvedAt: { gte: trendStart } },
          // Fallback for rows that never got approvedAt populated — use createdAt.
          { AND: [{ approvedAt: null }, { createdAt: { gte: trendStart } }] },
        ],
      },
      select: {
        approvedAt: true,
        createdAt: true,
        totalAmount: true,
        items: {
          select: {
            totalPrice: true,
            item: {
              select: {
                categoryId: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Helper — pick the bucket date (approvedAt preferred, createdAt fallback)
    const bucketDate = (po: (typeof pos)[number]): Date => po.approvedAt ?? po.createdAt;

    // ── Month totals ─────────────────────────────────────────────────────────
    let thisMonth = 0;
    let lastMonth = 0;

    // ── Trend (12 months) — index 0 = oldest, index 11 = current month ──────
    const trend = new Array<number>(12).fill(0);
    const monthIndex = (d: Date): number => {
      // Months between trendStart and d, clamped to [0, 11].
      const diff =
        (d.getFullYear() - trendStart.getFullYear()) * 12 + (d.getMonth() - trendStart.getMonth());
      if (diff < 0) return -1;
      if (diff > 11) return -1;
      return diff;
    };

    // ── Categories (only this-month spend, mirrors the card UX) ─────────────
    const categoryTotals = new Map<
      string, // key = categoryId ?? '__uncategorized'
      { categoryId: string | null; categoryName: string; total: number }
    >();

    for (const po of pos) {
      const bd = bucketDate(po);
      const total = Number(po.totalAmount);

      // Trend
      const idx = monthIndex(bd);
      if (idx >= 0) trend[idx] += total;

      // This / last month aggregates
      if (bd >= startOfThisMonth) {
        thisMonth += total;
        // Category breakdown only counts current month so the "100%" pie
        // matches the headline figure shown next to it.
        for (const it of po.items) {
          const catId = it.item?.categoryId ?? null;
          const catName = it.item?.category?.name ?? 'ไม่ระบุหมวด';
          const key = catId ?? '__uncategorized';
          const existing = categoryTotals.get(key);
          const linePrice = Number(it.totalPrice ?? 0);
          if (existing) {
            existing.total += linePrice;
          } else {
            categoryTotals.set(key, {
              categoryId: catId,
              categoryName: catName,
              total: linePrice,
            });
          }
        }
      } else if (bd >= startOfLastMonth && bd < endOfLastMonth) {
        lastMonth += total;
      }
    }

    const deltaPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

    // ── Build category list ──────────────────────────────────────────────────
    // Take top 3 by amount + lump the tail into "อื่น ๆ" so the card
    // stays readable when a tenant has many categories. Total here is taken
    // from the line-level sum (closer to true cost of goods) rather than the
    // PO totalAmount which includes shipping/tax — keeps the % proportional
    // to procurement value, not invoice-level overhead.
    const sorted = Array.from(categoryTotals.values()).sort((a, b) => b.total - a.total);
    const topN = 3;
    const top = sorted.slice(0, topN);
    const tail = sorted.slice(topN);
    const tailTotal = tail.reduce((s, c) => s + c.total, 0);
    const grand = sorted.reduce((s, c) => s + c.total, 0);

    const categories: Array<{
      categoryId: string | null;
      categoryName: string;
      total: number;
      pct: number;
    }> = top.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      total: Math.round(c.total),
      pct: grand > 0 ? Math.round((c.total / grand) * 100) : 0,
    }));
    if (tailTotal > 0) {
      categories.push({
        categoryId: null,
        categoryName: 'อื่น ๆ',
        total: Math.round(tailTotal),
        pct: grand > 0 ? Math.round((tailTotal / grand) * 100) : 0,
      });
    }

    return {
      thisMonth: Math.round(thisMonth),
      lastMonth: Math.round(lastMonth),
      deltaPct,
      trend: trend.map((n) => Math.round(n)),
      categories,
    };
  }

  /**
   * Sprint 2 — receiving-tab payload for a single PO.
   * Returns line-level ordered/received/pending plus a flat list of GRs.
   * The "lastGr" per line is computed from GoodsReceiveItem rows joined back
   * to their parent GoodsReceive — Prisma doesn't support a nested
   * `orderBy` on grand-children so we resolve it in-memory.
   */
  async findReceiving(id: string, tenantId: string): Promise<PurchaseOrderReceivingDetail> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        poNumber: true,
        status: true,
        items: {
          select: {
            id: true,
            itemId: true,
            quantity: true,
            receivedQty: true,
            unitPrice: true,
            totalPrice: true,
            item: { select: { name: true, sku: true, unit: true } },
          },
        },
        goodsReceives: {
          select: {
            id: true,
            grNumber: true,
            status: true,
            receiveDate: true,
            invoiceNumber: true,
            totalAmount: true,
            items: {
              select: {
                id: true,
                itemId: true,
                receivedQty: true,
                rejectedQty: true,
                lotId: true,
                expiryDate: true,
              },
            },
          },
          orderBy: { receiveDate: 'desc' },
        },
      },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    // Build a per-PO-item lookup of the most recent GR row that touched it.
    // We walk GRs from newest → oldest and take the first hit per itemId.
    const lastGrByItem = new Map<
      string,
      {
        grId: string;
        grNumber: string;
        receivedQty: number;
        rejectedQty: number;
        receiveDate: Date;
        lotId: string | null;
        expiryDate: Date | null;
      }
    >();
    for (const gr of po.goodsReceives) {
      for (const grItem of gr.items) {
        if (!lastGrByItem.has(grItem.itemId)) {
          lastGrByItem.set(grItem.itemId, {
            grId: gr.id,
            grNumber: gr.grNumber,
            receivedQty: grItem.receivedQty,
            rejectedQty: grItem.rejectedQty ?? 0,
            receiveDate: gr.receiveDate,
            lotId: grItem.lotId ?? null,
            expiryDate: grItem.expiryDate ?? null,
          });
        }
      }
    }

    const lines: PurchaseOrderReceivingLine[] = po.items.map((it) => {
      const ordered = it.quantity ?? 0;
      const received = it.receivedQty ?? 0;
      const pending = Math.max(0, ordered - received);
      const percent = ordered > 0 ? Math.round((received / ordered) * 100) : 0;

      let status: PurchaseOrderReceivingLine['status'];
      if (received === 0) status = 'PENDING';
      else if (received > ordered) status = 'OVER';
      else if (received < ordered) status = 'PARTIAL';
      else status = 'FULL';

      return {
        poItemId: it.id,
        itemId: it.itemId,
        sku: it.item?.sku ?? null,
        name: it.item?.name ?? null,
        unit: it.item?.unit ?? null,
        ordered,
        received,
        pending,
        percent,
        status,
        lastGr: lastGrByItem.get(it.itemId) ?? null,
      };
    });

    const orderedQty = lines.reduce((s, l) => s + l.ordered, 0);
    const receivedQty = lines.reduce((s, l) => s + l.received, 0);
    const pendingQty = Math.max(0, orderedQty - receivedQty);
    const percent = orderedQty > 0 ? Math.round((receivedQty / orderedQty) * 100) : 0;

    // Value rollup uses each line's recorded totalPrice as the "ordered" value
    // and prorates by received qty for received/pending — keeps the math
    // proportional even when line totals include discounts/tax.
    const orderedValue = po.items.reduce((s, it) => s + Number(it.totalPrice ?? 0), 0);
    const receivedValue = po.items.reduce((s, it) => {
      const ratio = (it.quantity ?? 0) > 0 ? (it.receivedQty ?? 0) / (it.quantity ?? 1) : 0;
      return s + Number(it.totalPrice ?? 0) * ratio;
    }, 0);
    const pendingValue = Math.max(0, orderedValue - receivedValue);

    return {
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      status: po.status,
      totals: {
        orderedQty,
        receivedQty,
        pendingQty,
        percent,
        orderedValue,
        receivedValue,
        pendingValue,
      },
      lines,
      grs: po.goodsReceives.map((gr) => ({
        id: gr.id,
        grNumber: gr.grNumber,
        status: gr.status,
        receiveDate: gr.receiveDate,
        invoiceNumber: gr.invoiceNumber,
        totalAmount: Number(gr.totalAmount ?? 0),
        itemCount: gr.items.length,
      })),
    };
  }

  async findOne(id: string, tenantId: string): Promise<Record<string, unknown>> {
    // `discountType` on items and `discountMode`/`headerDiscount*`/`calculationBreakdown`
    // on the PO are newly-added columns (see migration 20260417). They are cast via
    // the widened row types below until `prisma generate` runs against the updated schema.
    const poRaw = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            itemId: true,
            item: {
              select: {
                name: true,
                sku: true,
                unit: true,
              },
            },
            quantity: true,
            unitPrice: true,
            discount: true,
            discountType: true,
            taxRate: true,
            totalPrice: true,
            notes: true,
          } as unknown as Prisma.PurchaseOrderItemSelect,
        },
        supplier: {
          select: {
            id: true,
            name: true,
            code: true,
            contactPerson: true,
            email: true,
            phone: true,
            address: true,
            taxId: true,
            paymentTerms: true,
          },
        },
        goodsReceives: {
          select: {
            id: true,
            grNumber: true,
            status: true,
            receiveDate: true,
          },
        },
      },
    });

    if (!poRaw || poRaw.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    const po = poRaw as unknown as PurchaseOrderWithDiscount & {
      paymentTerms: string | null;
      deliveryAddress: string | null;
      items: (PurchaseOrderItemWithDiscountType & {
        item?: { name: string; sku: string } | null;
      })[];
      supplier: {
        id: string;
        name: string;
        code: string | null;
        contactPerson: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        taxId: string | null;
        paymentTerms: string | null;
      } | null;
      goodsReceives: Array<{ id: string; grNumber: string; status: string; receiveDate: Date }>;
    };

    // Resolve user names for approvedBy and requestedBy
    const userNameMap = await this.resolveUserNames([po.approvedBy, po.requestedBy]);

    return {
      id: po.id,
      poNumber: po.poNumber,
      status: po.status,
      propertyId: po.propertyId,
      supplierId: po.supplierId,
      supplierName: po.supplier?.name,
      supplier: po.supplier,
      warehouseId: po.warehouseId,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      notes: po.notes,
      internalNotes: po.internalNotes,
      paymentTerms: po.paymentTerms ?? po.supplier?.paymentTerms ?? null,
      deliveryAddress: po.deliveryAddress,
      quotationNumber: po.quotationNumber,
      quotationDate: po.quotationDate,
      purchaseRequisitionId: po.purchaseRequisitionId,
      subtotal: po.subtotal,
      discountAmount: po.discountAmount,
      discountMode: po.discountMode,
      headerDiscount: po.headerDiscount,
      headerDiscountType: po.headerDiscountType,
      calculationBreakdown: po.calculationBreakdown,
      taxAmount: po.taxAmount,
      totalAmount: po.totalAmount,
      currency: po.currency,
      cancelReason: po.cancelReason,
      cancelledAt: po.cancelledAt,
      items: po.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemName: item.item?.name,
        itemSku: item.item?.sku,
        // Include unit from the catalog item so GR form can pre-fill the unit label
        itemUnit: (item.item as unknown as { unit?: string } | null)?.unit ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        discountType: item.discountType,
        taxRate: item.taxRate,
        lineTotal: item.totalPrice,
        notes: item.notes,
      })),
      goodsReceives: po.goodsReceives,
      approvedBy: po.approvedBy || null,
      approvedByName: po.approvedBy ? userNameMap.get(po.approvedBy) || null : null,
      approvedAt: po.approvedAt,
      requestedBy: po.requestedBy,
      requestedByName: po.requestedBy ? userNameMap.get(po.requestedBy) || null : null,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
    };
  }

  async create(
    dto: CreatePurchaseOrderDto,
    userId: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    // Auto-resolve propertyId if not provided — use tenant's first property
    let propertyId = dto.propertyId;
    if (!propertyId) {
      const defaultProperty = await this.prisma.property.findFirst({
        where: { tenantId },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!defaultProperty) {
        throw new NotFoundException(
          'No property found for this tenant. Please create a property first.',
        );
      }
      propertyId = defaultProperty.id;
    }

    // Validate that property, supplier, warehouse, and items exist
    const [property, supplier, warehouse] = await Promise.all([
      this.prisma.property.findUnique({
        where: { id: propertyId },
      }),
      this.prisma.supplier.findUnique({
        where: { id: dto.supplierId },
      }),
      this.prisma.warehouse.findUnique({
        where: { id: dto.warehouseId },
      }),
    ]);

    if (!property || property.tenantId !== tenantId) {
      throw new NotFoundException('Property not found');
    }
    if (!supplier || supplier.tenantId !== tenantId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException('Warehouse not found');
    }

    // Supervisor approval gate: if a price comparison exists for this PR it
    // must be APPROVED before the PO can be created. Direct POs (without a
    // PR or with a PR that has no comparison) bypass this check.
    if (dto.purchaseRequisitionId) {
      const comparison = await this.prisma.priceComparison.findUnique({
        where: {
          tenantId_purchaseRequisitionId: {
            tenantId,
            purchaseRequisitionId: dto.purchaseRequisitionId,
          },
        },
      });

      if (comparison) {
        const status = (comparison as unknown as { status?: string }).status;
        if (status !== 'APPROVED') {
          throw new ConflictException({
            code: 'COMPARISON_NOT_APPROVED',
            message: 'ยังไม่ผ่านการอนุมัติคู่เทียบ — ต้องให้หัวหน้าจัดซื้ออนุมัติก่อน',
          });
        }
      }
    }

    // Verify all items exist
    const itemIds = dto.items.map((item) => item.itemId);
    const existingItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId },
      select: { id: true },
    });

    if (existingItems.length !== itemIds.length) {
      throw new NotFoundException('One or more inventory items not found');
    }

    // Calculate totals using shared module
    const discountMode: DiscountMode = dto.discountMode ?? 'BEFORE_VAT';
    const headerDiscountType: DiscountType = dto.headerDiscountType ?? 'AMOUNT';
    const breakdown = this.computeTotals(
      dto.items,
      dto.headerDiscount ?? 0,
      headerDiscountType,
      discountMode,
    );

    // Create in transaction: generate PO number, create PO and items
    const po = await this.prisma.$transaction(async (tx) => {
      const poNumber = await this.generateDocNumber(tenantId, 'PURCHASE_ORDER', 'PO', tx);

      // Payment terms: explicit DTO wins, fall back to supplier default so
      // the PO carries a sticky value even if the supplier's master data
      // changes later. Delivery address: only what the DTO says — admin is
      // expected to pick or type it in the UI.
      const paymentTerms = dto.paymentTerms ?? supplier.paymentTerms ?? null;
      const deliveryAddress = dto.deliveryAddress ?? null;

      const newPo = await tx.purchaseOrder.create({
        // `discountMode`, `headerDiscount`, `headerDiscountType`, and
        // `calculationBreakdown` are new columns (migration 20260417). Once
        // `prisma generate` runs in CI/deploy against the updated schema the
        // cast below becomes a no-op.
        data: {
          tenantId,
          poNumber,
          propertyId,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          notes: dto.notes || null,
          internalNotes: dto.internalNotes || null,
          quotationNumber: dto.quotationNumber || null,
          quotationDate: dto.quotationDate ? new Date(dto.quotationDate) : null,
          purchaseRequisitionId: dto.purchaseRequisitionId || null,
          paymentTerms,
          deliveryAddress,
          status: PurchaseOrderStatus.DRAFT,
          subtotal: breakdown.subtotal,
          discountAmount: breakdown.totalLineDiscount + breakdown.headerDiscountAmount,
          discountMode,
          headerDiscount: breakdown.headerDiscountAmount,
          headerDiscountType,
          calculationBreakdown: breakdown as unknown as Prisma.InputJsonValue,
          taxAmount: breakdown.vatAmount,
          totalAmount: breakdown.grandTotal,
          requestedBy: userId,
        } as unknown as Prisma.PurchaseOrderUncheckedCreateInput,
      });

      await tx.purchaseOrderItem.createMany({
        data: dto.items.map((item, idx) => this.buildItemRow(newPo.id, item, breakdown.lines[idx])),
      });

      if (dto.purchaseRequisitionId) {
        await tx.purchaseRequisition.update({
          where: { id: dto.purchaseRequisitionId },
          data: { status: 'PO_CREATED' },
        });
        this.logger.log(`PR ${dto.purchaseRequisitionId} status updated to PO_CREATED`);
      }

      return newPo;
    });

    this.logger.log(`Purchase order created: ${po.id} (${po.poNumber})`);
    return this.findOne(po.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdatePurchaseOrderDto,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const poRaw = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!poRaw || poRaw.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    // See note on PurchaseOrderWithDiscount at the top of this file.
    const po = poRaw as unknown as PurchaseOrderWithDiscount;

    if (
      ![PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING_APPROVAL].includes(
        po.status as PurchaseOrderStatus,
      )
    ) {
      throw new BadRequestException(
        'Purchase order can only be updated in DRAFT or PENDING_APPROVAL status',
      );
    }

    // Using a widened record here because discount fields are new (see migration
    // 20260417); we still cast to Prisma's input type at the boundary below.
    // `paymentTerms` and `deliveryAddress` are also new (migration 20260419) —
    // only included when DTO has them so we don't overwrite existing values with
    // undefined. Admin may explicitly null them out by sending an empty string.
    const updateData: Record<string, unknown> = {
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
      notes: dto.notes,
      internalNotes: dto.internalNotes,
      ...(dto.paymentTerms !== undefined && { paymentTerms: dto.paymentTerms || null }),
      ...(dto.deliveryAddress !== undefined && { deliveryAddress: dto.deliveryAddress || null }),
      updatedAt: new Date(),
    };

    // If items or discount fields are being updated, recalculate totals
    const willRecalculate =
      (dto.items && dto.items.length > 0) ||
      dto.discountMode !== undefined ||
      dto.headerDiscount !== undefined ||
      dto.headerDiscountType !== undefined;

    let breakdown: CalculationBreakdown | null = null;
    const discountMode: DiscountMode =
      dto.discountMode ?? (po.discountMode as DiscountMode) ?? 'BEFORE_VAT';
    const headerDiscountType: DiscountType =
      dto.headerDiscountType ?? (po.headerDiscountType as DiscountType) ?? 'AMOUNT';
    const headerDiscountValue =
      dto.headerDiscount ?? (po.headerDiscount ? Number(po.headerDiscount) : 0);

    if (willRecalculate) {
      let items: PurchaseOrderItemInput[] = [];
      if (dto.items && dto.items.length > 0) {
        const itemIds = dto.items.map((item) => item.itemId);
        const existingItems = await this.prisma.inventoryItem.findMany({
          where: { id: { in: itemIds }, tenantId },
          select: { id: true },
        });
        if (existingItems.length !== itemIds.length) {
          throw new NotFoundException('One or more inventory items not found');
        }
        items = dto.items;
      } else {
        // No new items — reuse existing items from DB for recalc
        const existingRaw = await this.prisma.purchaseOrderItem.findMany({
          where: { purchaseOrderId: id },
        });
        const existing = existingRaw as unknown as PurchaseOrderItemWithDiscountType[];
        items = existing.map((i) => ({
          itemId: i.itemId,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          discount: Number(i.discount),
          discountType: (i.discountType ?? 'PERCENT') as DiscountType,
          taxRate: Number(i.taxRate),
          notes: i.notes ?? undefined,
        }));
      }

      breakdown = this.computeTotals(items, headerDiscountValue, headerDiscountType, discountMode);

      updateData.subtotal = breakdown.subtotal;
      updateData.discountAmount = breakdown.totalLineDiscount + breakdown.headerDiscountAmount;
      updateData.discountMode = discountMode;
      updateData.headerDiscount = breakdown.headerDiscountAmount;
      updateData.headerDiscountType = headerDiscountType;
      updateData.calculationBreakdown = breakdown as unknown as Prisma.InputJsonValue;
      updateData.taxAmount = breakdown.vatAmount;
      updateData.totalAmount = breakdown.grandTotal;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPo = await tx.purchaseOrder.update({
        where: { id },
        data: updateData as unknown as Prisma.PurchaseOrderUncheckedUpdateInput,
      });

      if (dto.items && dto.items.length > 0 && breakdown) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });

        await tx.purchaseOrderItem.createMany({
          data: dto.items.map((item, idx) => this.buildItemRow(id, item, breakdown!.lines[idx])),
        });
      }

      return updatedPo;
    });

    this.logger.log(`Purchase order updated: ${id}`);
    return this.findOne(updated.id, tenantId);
  }

  async submitForApproval(id: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT purchase orders can be submitted for approval');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.PENDING_APPROVAL,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Purchase order submitted for approval: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  async approve(id: string, userId: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Only PENDING_APPROVAL purchase orders can be approved');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APPROVED,
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Purchase order approved: ${id} (${updated.poNumber}) by user ${userId}`);
    return this.findOne(updated.id, tenantId);
  }

  async cancel(
    id: string,
    userId: string,
    reason: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    const nonCancellableStatuses = [PurchaseOrderStatus.FULLY_RECEIVED, PurchaseOrderStatus.CLOSED];

    if (nonCancellableStatuses.includes(po.status as PurchaseOrderStatus)) {
      throw new BadRequestException('Cannot cancel a FULLY_RECEIVED or CLOSED purchase order');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelReason: reason,
        cancelledBy: userId,
        cancelledAt: new Date(),
      },
    });

    this.logger.log(`Purchase order cancelled: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  /**
   * Sprint 4 — force-close a PO that won't be received in full.
   *
   * Use case: supplier can't deliver remaining qty (out of stock, contract
   * cancelled, late beyond tolerance). Admin closes the PO with a reason and
   * the difference between ordered and received becomes the recorded variance,
   * surfaced in the variance report so finance can chase a refund / credit.
   *
   * Allowed from APPROVED or PARTIALLY_RECEIVED only — DRAFT/PENDING_APPROVAL
   * use plain `cancel`, FULLY_RECEIVED uses plain `close`.
   */
  async forceClose(
    id: string,
    userId: string,
    reason: string,
    tenantId: string,
  ): Promise<Record<string, unknown>> {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('A reason of at least 5 characters is required to force-close');
    }

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    const allowed: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ];
    if (!allowed.includes(po.status as PurchaseOrderStatus)) {
      throw new BadRequestException(
        'Force-close is only allowed for APPROVED or PARTIALLY_RECEIVED purchase orders',
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CLOSED,
        forceClosedAt: new Date(),
        forceClosedBy: userId,
        forceClosedReason: reason.trim(),
        updatedAt: new Date(),
      } as unknown as Prisma.PurchaseOrderUncheckedUpdateInput,
    });

    this.logger.log(
      `Purchase order force-closed: ${id} (${updated.poNumber}) by ${userId} — "${reason.slice(0, 60)}"`,
    );
    return this.findOne(updated.id, tenantId);
  }

  async close(id: string, tenantId: string): Promise<Record<string, unknown>> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!po || po.tenantId !== tenantId) {
      throw new NotFoundException('Purchase order not found');
    }

    if (po.status !== PurchaseOrderStatus.FULLY_RECEIVED) {
      throw new BadRequestException('Only FULLY_RECEIVED purchase orders can be closed');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CLOSED,
      },
    });

    this.logger.log(`Purchase order closed: ${id} (${updated.poNumber})`);
    return this.findOne(updated.id, tenantId);
  }

  /**
   * Build a single PurchaseOrderItem row from DTO + computed line breakdown.
   * `discountType` is a new column (migration 20260417) and is not yet in the
   * generated input type until `prisma generate` runs — cast at the boundary.
   */
  private buildItemRow(
    purchaseOrderId: string,
    item: PurchaseOrderItemInput,
    lineBreakdown: LineBreakdown,
  ): Prisma.PurchaseOrderItemCreateManyInput {
    return {
      purchaseOrderId,
      itemId: item.itemId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount ?? 0,
      discountType: (item.discountType ?? 'PERCENT') as DiscountType,
      taxRate: item.taxRate ?? 0,
      totalPrice: lineBreakdown.lineTotal,
      notes: item.notes || null,
    } as unknown as Prisma.PurchaseOrderItemCreateManyInput;
  }

  private async generateDocNumber(
    tenantId: string,
    docType: string,
    prefix: string,
    prismaTransaction: Prisma.TransactionClient,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    const seq = await prismaTransaction.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType, yearMonth } },
      create: { tenantId, docType, prefix, yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });

    return `${prefix}-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }
}
