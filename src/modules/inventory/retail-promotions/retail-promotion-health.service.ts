import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RetailPromotionStatus, WarehouseType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  assessPromotion,
  giftRuns,
  HealthGift,
  PromoAlert,
  shouldAutoPause,
} from './promotion-health';

type Db = Prisma.TransactionClient | PrismaService;

const PROMO_SELECT = {
  id: true,
  name: true,
  status: true,
  discountType: true,
  usageLimit: true,
  usedCount: true,
  giftWarehouseId: true,
  autoPausedAt: true,
  pausedReason: true,
  gifts: { select: { itemId: true, quantity: true, budgetQty: true, issuedQty: true } },
} satisfies Prisma.RetailPromotionSelect;

type PromoRow = Prisma.RetailPromotionGetPayload<{ select: typeof PROMO_SELECT }>;

export interface PromotionAlertsResult {
  alerts: PromoAlert[];
  /** โปรที่ระบบหยุดเอง — รอผู้จัดการเติมของ/งบแล้วเปิดใหม่ */
  autoPaused: Array<{ promotionId: string; promotionName: string; pausedAt: Date; reason: string | null }>;
}

export interface GiftStockRow {
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  avgCost: number;
  totalValue: number;
  /** โปรที่ยังใช้งาน/พักอยู่ซึ่งแจกของชิ้นนี้จากคลังนี้ — runs = แจกได้อีกกี่บิล */
  promotions: Array<{ promotionId: string; name: string; status: string; perBill: number; runs: number }>;
}

export interface GiftWarehouseStock {
  warehouseId: string;
  name: string;
  code: string;
  isActive: boolean;
  items: GiftStockRow[];
}

/**
 * แจ้งเตือนของแถมใกล้หมด / งบใกล้เต็ม / โควตาใกล้เต็ม และหยุดโปรอัตโนมัติ
 */
@Injectable()
export class RetailPromotionHealthService {
  private readonly logger = new Logger(RetailPromotionHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async alerts(tenantId: string): Promise<PromotionAlertsResult> {
    const rows = await this.prisma.retailPromotion.findMany({
      where: {
        tenantId,
        OR: [
          { status: RetailPromotionStatus.ACTIVE },
          { status: RetailPromotionStatus.PAUSED, autoPausedAt: { not: null } },
        ],
      },
      select: PROMO_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    const gifts = await this.loadGifts(this.prisma, tenantId, rows);

    const alerts = rows
      .filter((r) => r.status === RetailPromotionStatus.ACTIVE)
      .flatMap((r) => assessPromotion(this.toHealth(r), gifts.get(r.id) ?? []))
      // วิกฤตก่อน แล้วเรียงตามที่เหลือน้อยสุด
      .sort((a, b) => (a.severity === b.severity ? a.remainingRuns - b.remainingRuns : a.severity === 'critical' ? -1 : 1));

    const autoPaused = rows
      .filter((r) => r.status === RetailPromotionStatus.PAUSED && r.autoPausedAt)
      .map((r) => ({
        promotionId: r.id,
        promotionName: r.name,
        pausedAt: r.autoPausedAt as Date,
        reason: r.pausedReason,
      }));
    return { alerts, autoPaused };
  }

  /**
   * สต็อกในคลังของแถม (type = PROMOTION) ทุกคลังของ tenant พร้อมบอกว่าแต่ละชิ้นผูกกับโปรไหน แจกได้อีกกี่บิล
   * รวมของที่ไม่มีโปรใช้ด้วย — ผู้จัดการจะได้เห็นของค้างคลังที่ควรโอนกลับ
   */
  async giftStock(tenantId: string): Promise<GiftWarehouseStock[]> {
    const warehouses = await this.prisma.warehouse.findMany({
      where: { tenantId, type: WarehouseType.PROMOTION, deletedAt: null },
      select: { id: true, name: true, code: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    if (!warehouses.length) return [];
    const warehouseIds = warehouses.map((w) => w.id);

    const [stocks, promos] = await Promise.all([
      this.prisma.warehouseStock.findMany({
        where: { warehouseId: { in: warehouseIds }, warehouse: { tenantId } },
        select: {
          warehouseId: true,
          itemId: true,
          quantity: true,
          avgCost: true,
          totalValue: true,
          item: { select: { name: true, sku: true, unit: true } },
        },
      }),
      this.prisma.retailPromotion.findMany({
        where: {
          tenantId,
          giftWarehouseId: { in: warehouseIds },
          status: { in: [RetailPromotionStatus.ACTIVE, RetailPromotionStatus.PAUSED, RetailPromotionStatus.DRAFT] },
        },
        select: PROMO_SELECT,
      }),
    ]);

    const byWarehouse = new Map<string, GiftStockRow[]>(warehouseIds.map((id) => [id, []]));
    const rowOf = (warehouseId: string, itemId: string) =>
      byWarehouse.get(warehouseId)?.find((r) => r.itemId === itemId);

    for (const s of stocks) {
      byWarehouse.get(s.warehouseId)?.push({
        itemId: s.itemId,
        name: s.item.name,
        sku: s.item.sku,
        unit: s.item.unit,
        quantity: s.quantity,
        avgCost: Number(s.avgCost),
        totalValue: Number(s.totalValue),
        promotions: [],
      });
    }

    const gifts = await this.loadGifts(this.prisma, tenantId, promos);
    for (const p of promos) {
      if (!p.giftWarehouseId) continue;
      for (const g of gifts.get(p.id) ?? []) {
        let row = rowOf(p.giftWarehouseId, g.itemId);
        if (!row) {
          // โปรผูกของที่ยังไม่เคยเข้าคลังนี้ — แสดงเป็น 0 ให้เห็นว่าต้องโอนเข้า
          row = { itemId: g.itemId, name: g.name, sku: '', unit: g.unit, quantity: 0, avgCost: 0, totalValue: 0, promotions: [] };
          byWarehouse.get(p.giftWarehouseId)?.push(row);
        }
        row.promotions.push({
          promotionId: p.id,
          name: p.name,
          status: p.status,
          perBill: g.quantity,
          runs: giftRuns(g).runs,
        });
      }
    }

    return warehouses.map((w) => ({
      warehouseId: w.id,
      name: w.name,
      code: w.code,
      isActive: w.isActive,
      items: (byWarehouse.get(w.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'th')),
    }));
  }

  /**
   * เรียกในทรานแซกชันขาย หลังตัดสต็อกของแถมและเพิ่ม issuedQty แล้ว — อ่านค่าหลังตัดจาก tx เดียวกัน
   * หยุดแบบมีเงื่อนไข status = ACTIVE ผู้จัดการที่เพิ่งกดหยุดเองจะไม่ถูกเขียนทับเหตุผล
   */
  async autoPauseIfExhaustedWithin(tx: Db, tenantId: string, promotionId: string): Promise<boolean> {
    const promo = await tx.retailPromotion.findFirst({
      where: { id: promotionId, tenantId },
      select: PROMO_SELECT,
    });
    if (!promo || promo.status !== RetailPromotionStatus.ACTIVE) return false;

    const gifts = (await this.loadGifts(tx, tenantId, [promo])).get(promo.id) ?? [];
    const reason = shouldAutoPause(this.toHealth(promo), gifts);
    if (!reason) return false;

    const { count } = await tx.retailPromotion.updateMany({
      where: { id: promo.id, tenantId, status: RetailPromotionStatus.ACTIVE },
      data: { status: RetailPromotionStatus.PAUSED, autoPausedAt: new Date(), pausedReason: reason },
    });
    if (count > 0) this.logger.warn(`Promotion ${promo.id} auto-paused (tenant ${tenantId}): ${reason}`);
    return count > 0;
  }

  /** ของแถมของแต่ละโปร พร้อมคงเหลือในคลังของแถมของโปรนั้น */
  private async loadGifts(db: Db, tenantId: string, rows: PromoRow[]): Promise<Map<string, HealthGift[]>> {
    const itemIds = [...new Set(rows.flatMap((r) => r.gifts.map((g) => g.itemId)))];
    const warehouseIds = [...new Set(rows.map((r) => r.giftWarehouseId).filter((id): id is string => !!id))];
    if (!itemIds.length) return new Map();

    const [items, stocks] = await Promise.all([
      db.inventoryItem.findMany({
        where: { tenantId, id: { in: itemIds } },
        select: { id: true, name: true, unit: true },
      }),
      warehouseIds.length
        ? db.warehouseStock.findMany({
            // warehouse_stocks ไม่มี tenantId — ผูก tenant ผ่านคลังแทน
            where: { warehouseId: { in: warehouseIds }, itemId: { in: itemIds }, warehouse: { tenantId } },
            select: { warehouseId: true, itemId: true, quantity: true },
          })
        : Promise.resolve([]),
    ]);
    const itemMap = new Map(items.map((i) => [i.id, i]));
    const stockMap = new Map(stocks.map((s) => [`${s.warehouseId}:${s.itemId}`, Number(s.quantity)]));

    return new Map(
      rows.map((r) => [
        r.id,
        r.gifts.map((g) => ({
          itemId: g.itemId,
          name: itemMap.get(g.itemId)?.name ?? '—',
          unit: itemMap.get(g.itemId)?.unit ?? '',
          quantity: g.quantity,
          budgetQty: g.budgetQty,
          issuedQty: g.issuedQty,
          stockQty: r.giftWarehouseId ? stockMap.get(`${r.giftWarehouseId}:${g.itemId}`) ?? 0 : 0,
        })),
      ]),
    );
  }

  private toHealth(r: PromoRow) {
    return {
      id: r.id,
      name: r.name,
      discountType: r.discountType,
      usageLimit: r.usageLimit,
      usedCount: r.usedCount,
    };
  }
}
