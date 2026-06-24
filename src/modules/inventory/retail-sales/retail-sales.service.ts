import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RetailPaymentMethod } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateRetailSaleDto } from './dto/create-retail-sale.dto';
import { QueryRetailSaleDto } from './dto/query-retail-sale.dto';

/** Round to 2 decimal places (THB). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class RetailSalesService {
  private readonly logger = new Logger(RetailSalesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a retail (POS) sale.
   *
   * Everything happens inside ONE transaction so the whole cart is atomic:
   *   1. generate the receipt number (DocumentSequence)
   *   2. for each line — deduct WarehouseStock and (for lot-tracked items) the
   *      FEFO InventoryLot remainingQty, writing a GOODS_ISSUE StockMovement
   *      (referenceType RETAIL_SALE) that the stock-balance report reads
   *   3. create the RetailSale header + snapshotted line items
   *
   * Money totals are recomputed server-side; the client's numbers are never trusted.
   */
  async create(dto: CreateRetailSaleDto, userId: string, tenantId: string) {
    // Validate the store/warehouse belongs to this tenant.
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
    });
    if (!warehouse) {
      throw new BadRequestException('ไม่พบคลัง/ร้านค้านี้ หรือไม่ได้อยู่ในองค์กรของคุณ');
    }

    if (dto.paymentMethod === RetailPaymentMethod.ROOM_CHARGE) {
      if (!dto.roomNumber?.trim() || !dto.guestName?.trim()) {
        throw new BadRequestException('ต้องระบุเลขห้องและชื่อแขกสำหรับการชาร์จเข้าห้อง');
      }
    }

    // Load every item up front (tenant-scoped) so we can validate + snapshot fields.
    const itemIds = [...new Set(dto.lines.map((l) => l.itemId))];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, tenantId, deletedAt: null },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    for (const line of dto.lines) {
      if (!itemMap.has(line.itemId)) {
        throw new BadRequestException(`ไม่พบสินค้า (itemId: ${line.itemId}) ในองค์กรของคุณ`);
      }
    }

    const saleId = randomUUID();
    const vatRate = dto.vatRate ?? 7;
    const billDiscount = dto.billDiscount ?? 0;

    const sale = await this.prisma.$transaction(async (tx) => {
      const receiptNo = await this.generateReceiptNo(tx, tenantId);

      const lineRows: Prisma.RetailSaleItemCreateManySaleInput[] = [];
      let subtotal = 0;
      let itemDiscountTotal = 0;
      let costTotal = 0;

      for (const line of dto.lines) {
        const item = itemMap.get(line.itemId)!;
        const lineDiscount = round2(line.lineDiscount ?? 0);

        // Authoritative balance + average cost for this store/item.
        const stock = await tx.warehouseStock.findFirst({
          where: { warehouseId: dto.warehouseId, itemId: line.itemId },
        });
        if (!stock) {
          throw new BadRequestException(`ไม่มีสต็อกสินค้า "${item.name}" ในคลังนี้`);
        }
        const currentQty = Number(stock.quantity);
        if (currentQty < line.quantity) {
          throw new BadRequestException(
            `สต็อก "${item.name}" ไม่เพียงพอ: คลังมี ${currentQty} ${item.unit} แต่ต้องการ ${line.quantity}`,
          );
        }
        const avgCost = Number(stock.avgCost) || 0;

        // Deduct stock + write GOODS_ISSUE movement(s). Lot-tracked items deduct
        // FEFO across one or more lots; plain items deduct a single movement.
        await this.issueStockForLine(tx, {
          tenantId,
          userId,
          saleId,
          warehouseId: dto.warehouseId,
          itemId: line.itemId,
          quantity: line.quantity,
          avgCost,
          needsLot: item.isPerishable || item.requiresLotTracking,
        });

        // Decrement the authoritative WarehouseStock balance.
        const newQty = currentQty - line.quantity;
        await tx.warehouseStock.update({
          where: { id: stock.id },
          data: {
            quantity: newQty,
            totalValue: round2(newQty * avgCost),
            updatedAt: new Date(),
          },
        });

        const gross = line.quantity * line.unitPrice;
        const lineTotal = round2(Math.max(gross - lineDiscount, 0));
        const lineCost = round2(line.quantity * avgCost);

        subtotal += gross;
        itemDiscountTotal += lineDiscount;
        costTotal += lineCost;

        lineRows.push({
          id: randomUUID(),
          itemId: line.itemId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          quantity: line.quantity,
          unitPrice: round2(line.unitPrice),
          lineDiscount,
          lineTotal,
          unitCost: round2(avgCost),
          lineCost,
        });
      }

      subtotal = round2(subtotal);
      const discountTotal = round2(Math.min(subtotal, itemDiscountTotal + billDiscount));
      const taxable = Math.max(subtotal - discountTotal, 0);
      const vatAmount = round2((taxable * vatRate) / 100);
      const grandTotal = round2(taxable + vatAmount);
      costTotal = round2(costTotal);
      const profitTotal = round2(taxable - costTotal);

      return tx.retailSale.create({
        data: {
          id: saleId,
          tenantId,
          receiptNo,
          warehouseId: dto.warehouseId,
          paymentMethod: dto.paymentMethod,
          roomNumber: dto.roomNumber?.trim() || null,
          guestName: dto.guestName?.trim() || null,
          bookingId: dto.bookingId || null,
          subtotal,
          discountTotal,
          vatRate,
          vatAmount,
          grandTotal,
          costTotal,
          profitTotal,
          notes: dto.notes?.trim() || null,
          soldBy: userId,
          items: { createMany: { data: lineRows } },
        },
        include: { items: true },
      });
    });

    this.logger.log(`Retail sale ${sale.receiptNo} created (tenant ${tenantId}, total ${sale.grandTotal})`);
    return this.toDetail(sale);
  }

  /** Sales history (ประวัติการขาย) — paginated + filterable, newest first, with range totals. */
  async findAll(tenantId: string, query: QueryRetailSaleDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: Prisma.RetailSaleWhereInput = { tenantId };
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.soldAt = {};
      if (query.from) where.soldAt.gte = new Date(query.from);
      if (query.to) where.soldAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [{ receiptNo: { contains: term } }, { guestName: { contains: term } }];
    }

    const [rows, total, agg] = await Promise.all([
      this.prisma.retailSale.findMany({
        where,
        include: { items: true },
        orderBy: { soldAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.retailSale.count({ where }),
      this.prisma.retailSale.aggregate({
        where,
        _sum: { grandTotal: true, profitTotal: true, costTotal: true },
      }),
    ]);

    return {
      data: rows.map((r) => this.toDetail(r)),
      meta: { page, limit, total },
      summary: {
        count: total,
        totalSales: Number(agg._sum.grandTotal ?? 0),
        totalCost: Number(agg._sum.costTotal ?? 0),
        totalProfit: Number(agg._sum.profitTotal ?? 0),
      },
    };
  }

  /** Single receipt detail. */
  async findOne(id: string, tenantId: string) {
    const sale = await this.prisma.retailSale.findFirst({
      where: { id, tenantId },
      include: { items: true },
    });
    if (!sale) {
      throw new NotFoundException('ไม่พบรายการขายนี้');
    }
    return this.toDetail(sale);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** Generate a per-tenant, per-month receipt number, e.g. RCP-202606-0001. */
  private async generateReceiptNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'RETAIL_SALE', yearMonth } },
      create: { tenantId, docType: 'RETAIL_SALE', prefix: 'RCP', yearMonth, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return `RCP-${yearMonth}-${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Issue stock for one cart line as GOODS_ISSUE movement(s) tied to the sale.
   * Lot-tracked / perishable items consume FEFO lots (earliest expiry first) and
   * write one movement per consumed lot; plain items write a single movement.
   * WarehouseStock balance itself is decremented by the caller.
   */
  private async issueStockForLine(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      userId: string;
      saleId: string;
      warehouseId: string;
      itemId: string;
      quantity: number;
      avgCost: number;
      needsLot: boolean;
    },
  ): Promise<void> {
    const { tenantId, userId, saleId, warehouseId, itemId, quantity, avgCost, needsLot } = params;

    if (needsLot) {
      const lots = await tx.inventoryLot.findMany({
        where: { tenantId, itemId, warehouseId, status: 'ACTIVE', remainingQty: { gt: 0 } },
        orderBy: [{ expiryDate: 'asc' }, { receivedDate: 'asc' }],
      });
      const available = lots.reduce((sum, l) => sum + l.remainingQty, 0);
      if (available >= quantity) {
        // Consume FEFO across lots.
        let remaining = quantity;
        for (const lot of lots) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, lot.remainingQty);
          const newRemaining = lot.remainingQty - take;
          await tx.inventoryLot.update({
            where: { id: lot.id },
            data: {
              remainingQty: newRemaining,
              status: newRemaining === 0 ? 'EXHAUSTED' : lot.status,
              updatedAt: new Date(),
            },
          });
          const unitCost = Number(lot.unitCost) || avgCost;
          await tx.stockMovement.create({
            data: {
              id: randomUUID(),
              tenantId,
              warehouseId,
              itemId,
              type: 'GOODS_ISSUE',
              quantity: take,
              unitCost,
              totalCost: round2(take * unitCost),
              referenceType: 'RETAIL_SALE',
              referenceId: saleId,
              createdBy: userId,
              lotId: lot.id,
            },
          });
          remaining -= take;
        }
        return;
      }
      // Lot coverage is short (data drift): fall through to a single non-lot movement
      // so the sale still reconciles against the authoritative WarehouseStock balance.
      this.logger.warn(
        `Item ${itemId} lot coverage ${available} < ${quantity}; issuing against warehouse balance only`,
      );
    }

    await tx.stockMovement.create({
      data: {
        id: randomUUID(),
        tenantId,
        warehouseId,
        itemId,
        type: 'GOODS_ISSUE',
        quantity,
        unitCost: avgCost,
        totalCost: round2(quantity * avgCost),
        referenceType: 'RETAIL_SALE',
        referenceId: saleId,
        createdBy: userId,
      },
    });
  }

  /** Map a Prisma RetailSale (+items) to a number-normalized API shape. */
  private toDetail(sale: {
    id: string;
    receiptNo: string;
    warehouseId: string;
    status: string;
    paymentMethod: string;
    roomNumber: string | null;
    guestName: string | null;
    bookingId: string | null;
    subtotal: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    vatRate: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    grandTotal: Prisma.Decimal;
    costTotal: Prisma.Decimal;
    profitTotal: Prisma.Decimal;
    notes: string | null;
    soldBy: string;
    soldAt: Date;
    createdAt: Date;
    items: Array<{
      id: string;
      itemId: string;
      sku: string;
      name: string;
      unit: string;
      quantity: number;
      unitPrice: Prisma.Decimal;
      lineDiscount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineCost: Prisma.Decimal;
    }>;
  }) {
    return {
      id: sale.id,
      receiptNo: sale.receiptNo,
      warehouseId: sale.warehouseId,
      status: sale.status,
      paymentMethod: sale.paymentMethod,
      roomNumber: sale.roomNumber,
      guestName: sale.guestName,
      bookingId: sale.bookingId,
      subtotal: Number(sale.subtotal),
      discountTotal: Number(sale.discountTotal),
      vatRate: Number(sale.vatRate),
      vatAmount: Number(sale.vatAmount),
      grandTotal: Number(sale.grandTotal),
      costTotal: Number(sale.costTotal),
      profitTotal: Number(sale.profitTotal),
      notes: sale.notes,
      soldBy: sale.soldBy,
      soldAt: sale.soldAt,
      createdAt: sale.createdAt,
      items: sale.items.map((it) => ({
        id: it.id,
        itemId: it.itemId,
        sku: it.sku,
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        lineDiscount: Number(it.lineDiscount),
        lineTotal: Number(it.lineTotal),
        unitCost: Number(it.unitCost),
        lineCost: Number(it.lineCost),
      })),
    };
  }
}
