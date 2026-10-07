import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, RetailSaleStatus, RevenueSourceType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  FolioPostingService,
  FOLIO_SOURCE_TYPE,
} from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import { RetailPromotionsService } from '../retail-promotions/retail-promotions.service';
import { emitRetailSaleVoided } from './retail-sale-events';

/** referenceType ของการตัดสต็อกตอนขาย → referenceType ของการคืนสต็อกตอน void */
const VOID_REFERENCE: Record<string, string> = {
  RETAIL_SALE: 'RETAIL_SALE_VOID',
  PROMO_GIFT: 'PROMO_GIFT_VOID',
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface VoidRetailSaleResult {
  id: string;
  receiptNo: string;
  status: RetailSaleStatus;
  voidedAt: Date;
  voidReason: string;
  /** จำนวนชิ้นที่คืนเข้าคลัง (สินค้า + ของแถม) */
  restockedQty: number;
  folioReversed: boolean;
  promoReversed: boolean;
}

/**
 * ยกเลิกใบเสร็จร้านค้า/มินิบาร์ทั้งใบ
 *
 * ทุกอย่างที่ `RetailSalesService.create` ทำไว้ถูกย้อนใน transaction เดียว —
 * พลาดจุดเดียวย้อนทั้งหมด ไม่มีสภาพ "ใบเสร็จถูกยกเลิกแต่ของยังไม่คืนคลัง":
 *
 *   1. ตีสถานะ COMPLETED → VOIDED แบบมีเงื่อนไข (กดยกเลิกซ้ำ/พร้อมกัน = ทำได้ครั้งเดียว)
 *   2. คืนสต็อกทุกการเคลื่อนไหวที่ใบนี้ตัดออก (ทั้งสินค้าและของแถม) กลับคลังเดิม
 *      ล็อตเดิม ที่ต้นทุนเดิม เป็น ADJUSTMENT_IN — ไม่ใช่คิดจากบรรทัดใบเสร็จ
 *      เพราะบรรทัดเดียวอาจตัดจากหลายล็อตคนละต้นทุน
 *   3. คืนโควตาโปร/โค้ด/สมาชิก/งบของแถม และตี redemption เป็น REVERSED
 *   4. กลับรายการในโฟลิโอห้อง (เฉพาะโฟลิโอที่ยังเปิด)
 *   5. ยกเลิกรายได้ในสมุดกลาง (วันเดียวกัน = VOIDED, ข้ามวัน = แถวติดลบ)
 */
@Injectable()
export class RetailSaleVoidService {
  private readonly logger = new Logger(RetailSaleVoidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly folioPosting: FolioPostingService,
    private readonly revenuePosting: RevenuePostingService,
    private readonly promotions: RetailPromotionsService,
    private readonly events: EventEmitter2,
  ) {}

  async void(
    saleId: string,
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<VoidRetailSaleResult> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      throw new BadRequestException({ code: 'VOID_REASON_REQUIRED', message: 'ต้องระบุเหตุผลการยกเลิก' });
    }

    const sale = await this.prisma.retailSale.findFirst({
      where: { id: saleId, tenantId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('ไม่พบรายการขายนี้');
    if (sale.status === RetailSaleStatus.VOIDED) {
      throw new BadRequestException({ code: 'SALE_ALREADY_VOIDED', message: `ใบเสร็จ ${sale.receiptNo} ถูกยกเลิกไปแล้ว` });
    }

    const voidedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.retailSale.updateMany({
        where: { id: sale.id, tenantId, status: RetailSaleStatus.COMPLETED },
        data: { status: RetailSaleStatus.VOIDED, voidedBy: userId, voidedAt, voidReason: trimmedReason },
      });
      if (flipped.count === 0) {
        throw new BadRequestException({ code: 'SALE_ALREADY_VOIDED', message: `ใบเสร็จ ${sale.receiptNo} ถูกยกเลิกไปแล้ว` });
      }

      const restockedQty = await this.restock(tx, { tenantId, userId, saleId: sale.id });

      const promo = await this.promotions.reverseRedemptionWithin(tx, {
        tenantId,
        saleId: sale.id,
        giftLines: sale.items.filter((it) => it.isGift).map((it) => ({ itemId: it.itemId, quantity: it.quantity })),
      });

      const folio = await this.folioPosting.reverseChargeWithin(tx, {
        tenantId,
        sourceType: FOLIO_SOURCE_TYPE.RETAIL_SALE,
        sourceId: sale.id,
        reversedBy: userId,
      });

      await this.revenuePosting.voidWithin(tx, {
        tenantId,
        sourceType: RevenueSourceType.RETAIL_SALE,
        sourceId: sale.id,
        voidedBy: userId,
        reason: trimmedReason,
        at: voidedAt,
      });

      return { restockedQty, folioReversed: folio != null, promoReversed: promo != null };
    });

    this.logger.log(
      `Retail sale ${sale.receiptNo} voided by ${userId} (tenant ${tenantId}, restocked ${result.restockedQty})`,
    );
    emitRetailSaleVoided(this.events, sale);
    return {
      id: sale.id,
      receiptNo: sale.receiptNo,
      status: RetailSaleStatus.VOIDED,
      voidedAt,
      voidReason: trimmedReason,
      ...result,
    };
  }

  /**
   * คืนของทุกชิ้นที่ใบนี้ตัดออก ตามการเคลื่อนไหว GOODS_ISSUE ของใบนี้เอง
   * คืนยอดคงเหลือ + มูลค่า แล้วคิด avgCost ใหม่แบบถัวเฉลี่ย (ของกลับมาที่ต้นทุนเดิม)
   */
  private async restock(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; userId: string; saleId: string },
  ): Promise<number> {
    const { tenantId, userId, saleId } = params;
    const issues = await tx.stockMovement.findMany({
      where: {
        tenantId,
        referenceId: saleId,
        referenceType: { in: Object.keys(VOID_REFERENCE) },
        type: 'GOODS_ISSUE',
      },
    });

    const balances = new Map<string, { warehouseId: string; itemId: string; qty: number; value: number }>();
    for (const issue of issues) {
      const unitCost = Number(issue.unitCost) || 0;
      await tx.stockMovement.create({
        data: {
          id: randomUUID(),
          tenantId,
          warehouseId: issue.warehouseId,
          itemId: issue.itemId,
          type: 'ADJUSTMENT_IN',
          quantity: issue.quantity,
          unitCost,
          totalCost: round2(issue.quantity * unitCost),
          referenceType: VOID_REFERENCE[issue.referenceType ?? 'RETAIL_SALE'],
          referenceId: saleId,
          createdBy: userId,
          lotId: issue.lotId,
        },
      });

      if (issue.lotId) {
        const lot = await tx.inventoryLot.findFirst({ where: { id: issue.lotId, tenantId } });
        if (lot) {
          await tx.inventoryLot.update({
            where: { id: lot.id },
            data: {
              remainingQty: { increment: issue.quantity },
              // ล็อตที่หมดเพราะใบนี้ กลับมามีของอีกครั้ง — ล็อตหมดอายุ/กักไว้คงสถานะเดิม
              ...(lot.status === 'EXHAUSTED' ? { status: 'ACTIVE' } : {}),
            },
          });
        }
      }

      const key = `${issue.warehouseId}:${issue.itemId}`;
      const cur = balances.get(key) ?? { warehouseId: issue.warehouseId, itemId: issue.itemId, qty: 0, value: 0 };
      cur.qty += issue.quantity;
      cur.value += issue.quantity * unitCost;
      balances.set(key, cur);
    }

    let restocked = 0;
    for (const back of balances.values()) {
      const stock = await tx.warehouseStock.findFirst({
        where: { warehouseId: back.warehouseId, itemId: back.itemId },
      });
      const prevQty = Math.max(Number(stock?.quantity ?? 0), 0);
      const prevValue = prevQty * (Number(stock?.avgCost ?? 0) || 0);
      const newQty = prevQty + back.qty;
      const newValue = round2(prevValue + back.value);
      const avgCost = newQty > 0 ? round2(newValue / newQty) : 0;
      if (stock) {
        await tx.warehouseStock.update({
          where: { id: stock.id },
          data: { quantity: Number(stock.quantity) + back.qty, avgCost, totalValue: newValue, updatedAt: new Date() },
        });
      } else {
        await tx.warehouseStock.create({
          data: { warehouseId: back.warehouseId, itemId: back.itemId, quantity: back.qty, avgCost, totalValue: newValue },
        });
      }
      restocked += back.qty;
    }
    return restocked;
  }
}
