import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EvaluatedGift } from '../retail-promotions/retail-promotions.service';
import { promoError, round2 } from '../retail-promotions/promotion-engine';

// ตัดสต็อกของบิลขายหน้าร้าน — แยกจาก RetailSalesService ให้ไฟล์บริการไม่เกิน 800 บรรทัด

/**
 * Issue stock for one cart line as GOODS_ISSUE movement(s) tied to the sale.
 * Lot-tracked / perishable items consume FEFO lots (earliest expiry first) and
 * write one movement per consumed lot; plain items write a single movement.
 * WarehouseStock balance itself is decremented by the caller.
 */
export async function issueStockForLine(
  tx: Prisma.TransactionClient,
  logger: Logger,
  params: {
    tenantId: string;
    userId: string;
    saleId: string;
    warehouseId: string;
    itemId: string;
    quantity: number;
    avgCost: number;
    needsLot: boolean;
    /** RETAIL_SALE (ขาย) หรือ PROMO_GIFT (ของแถมจากคลังของแถม) */
    referenceType?: 'RETAIL_SALE' | 'PROMO_GIFT';
  },
): Promise<void> {
  const { tenantId, userId, saleId, warehouseId, itemId, quantity, avgCost, needsLot } = params;
  const referenceType = params.referenceType ?? 'RETAIL_SALE';

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
            referenceType,
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
    logger.warn(`Item ${itemId} lot coverage ${available} < ${quantity}; issuing against warehouse balance only`);
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
      referenceType,
      referenceId: saleId,
      createdBy: userId,
    },
  });
}

/**
 * Issue one promotion gift from the gift warehouse (type PROMOTION) and return
 * its ฿0 receipt line. The real cost stays on the line so promo spend is
 * reportable, but it is kept out of costTotal (goods sold).
 */
export async function issueGiftLine(
  tx: Prisma.TransactionClient,
  logger: Logger,
  params: {
    tenantId: string;
    userId: string;
    saleId: string;
    promotionId: string;
    warehouseId: string;
    gift: EvaluatedGift;
  },
): Promise<Prisma.RetailSaleItemCreateManySaleInput> {
  const { tenantId, userId, saleId, promotionId, warehouseId, gift } = params;
  const item = await tx.inventoryItem.findFirst({ where: { id: gift.itemId, tenantId, deletedAt: null } });
  const stock = await tx.warehouseStock.findFirst({ where: { warehouseId, itemId: gift.itemId } });
  const currentQty = Number(stock?.quantity ?? 0);
  if (!item || !stock || currentQty < gift.quantity) {
    throw promoError('PROMO_GIFT_SHORTAGE', `ของแถม "${gift.name}" ในคลังของแถมไม่พอ`, {
      skippedItemIds: [gift.itemId],
      canAcceptWithoutGift: true,
    });
  }
  const avgCost = Number(stock.avgCost) || 0;
  await issueStockForLine(tx, logger, {
    tenantId,
    userId,
    saleId,
    warehouseId,
    itemId: gift.itemId,
    quantity: gift.quantity,
    avgCost,
    needsLot: item.isPerishable || item.requiresLotTracking,
    referenceType: 'PROMO_GIFT',
  });
  const newQty = currentQty - gift.quantity;
  await tx.warehouseStock.update({
    where: { id: stock.id },
    data: { quantity: newQty, totalValue: round2(newQty * avgCost), updatedAt: new Date() },
  });
  return {
    id: randomUUID(),
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    quantity: gift.quantity,
    unitPrice: 0,
    lineDiscount: 0,
    lineTotal: 0,
    unitCost: round2(avgCost),
    lineCost: round2(gift.quantity * avgCost),
    isGift: true,
    promotionId,
    sourceWarehouseId: warehouseId,
  };
}
