import { Injectable, Logger } from '@nestjs/common';
import {
  ItemUnit,
  RetailPromoCodeKind,
  RetailPromoDiscountType,
  RetailPromotionStatus,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** ของแถม — สินค้าแยกจากของขาย มีสต็อกอยู่ในคลังของแถมเท่านั้น หน้า POS จึงไม่เห็นเป็นของขาย */
const GIFT_CATALOG = [
  { sku: 'GIFT-TOTE', name: 'ถุงผ้าที่ระลึก (ของแถม)', unit: ItemUnit.PIECE, cost: 45, price: 150, qty: 30 },
  { sku: 'GIFT-KEYCHAIN', name: 'พวงกุญแจที่ระลึก (ของแถม)', unit: ItemUnit.PIECE, cost: 15, price: 59, qty: 2 },
] as const;

type GiftSku = (typeof GIFT_CATALOG)[number]['sku'];

interface DemoPromotion {
  name: string;
  description: string;
  discountType: RetailPromoDiscountType;
  discountValue: number;
  maxDiscount?: number;
  minSpend: number;
  eligibleTiers?: string[];
  usageLimit?: number;
  perMemberLimit?: number;
  gifts: Array<{ sku: GiftSku; quantity: number; budgetQty?: number }>;
  codes: Array<{ code: string; maxUses?: number }>;
}

/**
 * ครอบคลุมทุกทางเดินของหน้าขาย:
 *   WELCOME10 — ส่วนลดอย่างเดียว
 *   TOTE300   — ของแถมอย่างเดียว (ของหมด = ใช้ไม่ได้)
 *   GOLD50    — ส่วนลด + ของแถมที่มีแค่ 2 ชิ้น → ทดสอบ "รับเฉพาะส่วนลด"
 */
const DEMO_PROMOTIONS: DemoPromotion[] = [
  {
    name: 'สมาชิกลด 10% (สูงสุด ฿100)',
    description: 'ส่วนลดทั้งบิลสำหรับสมาชิกทุกระดับ',
    discountType: RetailPromoDiscountType.PERCENT,
    discountValue: 10,
    maxDiscount: 100,
    minSpend: 0,
    perMemberLimit: 5,
    gifts: [],
    codes: [{ code: 'WELCOME10' }],
  },
  {
    name: 'ซื้อครบ ฿300 รับถุงผ้าฟรี',
    description: 'ของแถมอย่างเดียว — ตัดจากคลังของแถม',
    discountType: RetailPromoDiscountType.NONE,
    discountValue: 0,
    minSpend: 300,
    usageLimit: 100,
    gifts: [{ sku: 'GIFT-TOTE', quantity: 1, budgetQty: 25 }],
    codes: [{ code: 'TOTE300' }],
  },
  {
    name: 'Gold ลด ฿50 + พวงกุญแจ',
    description: 'เฉพาะสมาชิก gold/platinum — พวงกุญแจมีจำกัด',
    discountType: RetailPromoDiscountType.FIXED,
    discountValue: 50,
    minSpend: 200,
    eligibleTiers: ['gold', 'platinum'],
    perMemberLimit: 1,
    gifts: [{ sku: 'GIFT-KEYCHAIN', quantity: 1 }],
    codes: [{ code: 'GOLD50' }],
  },
];

/**
 * คลังของแถม (Warehouse type PROMOTION) + โปรโมชั่นตัวอย่างของหน้าขายปลีก
 * ต้องรันหลัง ReadyMadeGoodsSeeder — ใช้สาขาเดียวกับคลังร้านขายของ (WH-RETAIL)
 *
 * แผน: docs/RETAIL_PROMOTIONS_PLAN.md
 */
@Injectable()
export class RetailPromotionsSeeder {
  private readonly logger = new Logger(RetailPromotionsSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(): Promise<void> {
    this.logger.log('🎁 Seeding retail promotions (คลังของแถม + โปรตัวอย่าง)...');
    const shops = await this.prisma.warehouse.findMany({
      where: { code: 'WH-RETAIL', deletedAt: null },
      select: { tenantId: true, propertyId: true },
      orderBy: { createdAt: 'asc' },
    });
    const seen = new Set<string>();
    for (const shop of shops) {
      // โปรผูกคลังของแถมได้คลังเดียว — ใช้สาขาแรกของแต่ละกิจการ
      if (seen.has(shop.tenantId)) continue;
      seen.add(shop.tenantId);
      await this.seedTenant(shop.tenantId, shop.propertyId);
    }
  }

  private async seedTenant(tenantId: string, propertyId: string | null): Promise<void> {
    const giftWarehouseId = await this.ensureGiftWarehouse(tenantId, propertyId);
    const items = await this.ensureGiftItems(tenantId, giftWarehouseId);

    for (const def of DEMO_PROMOTIONS) {
      const exists = await this.prisma.retailPromotion.findFirst({
        where: { tenantId, name: def.name },
        select: { id: true },
      });
      if (exists) continue;

      await this.prisma.retailPromotion.create({
        data: {
          tenantId,
          name: def.name,
          description: def.description,
          status: RetailPromotionStatus.ACTIVE,
          discountType: def.discountType,
          discountValue: def.discountValue,
          maxDiscount: def.maxDiscount ?? null,
          minSpend: def.minSpend,
          eligibleTiers: def.eligibleTiers ?? undefined,
          usageLimit: def.usageLimit ?? null,
          perMemberLimit: def.perMemberLimit ?? null,
          giftWarehouseId: def.gifts.length ? giftWarehouseId : null,
          gifts: {
            create: def.gifts.map((g) => ({
              tenantId,
              itemId: items[g.sku],
              quantity: g.quantity,
              budgetQty: g.budgetQty ?? null,
            })),
          },
          codes: {
            create: def.codes.map((c) => ({
              tenantId,
              code: c.code,
              kind: RetailPromoCodeKind.SHARED,
              maxUses: c.maxUses ?? null,
            })),
          },
        },
      });
    }
    this.logger.log(`  ✓ Gift warehouse + ${DEMO_PROMOTIONS.length} promotions for tenant ${tenantId}`);
  }

  private async ensureGiftWarehouse(tenantId: string, propertyId: string | null): Promise<string> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: 'WH-GIFT', deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.warehouse.create({
      data: {
        tenantId,
        propertyId,
        code: 'WH-GIFT',
        name: 'คลังของแถม',
        type: WarehouseType.PROMOTION,
        isDefault: false,
        isActive: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** สินค้าของแถม + ยอดตั้งต้นในคลังของแถม (สร้างเฉพาะที่ยังไม่มี ไม่ทับยอดที่ใช้ไปแล้ว) */
  private async ensureGiftItems(tenantId: string, warehouseId: string): Promise<Record<GiftSku, string>> {
    const ids = {} as Record<GiftSku, string>;
    for (const gift of GIFT_CATALOG) {
      const item =
        (await this.prisma.inventoryItem.findFirst({ where: { tenantId, sku: gift.sku }, select: { id: true } })) ??
        (await this.prisma.inventoryItem.create({
          data: {
            tenantId,
            sku: gift.sku,
            name: gift.name,
            unit: gift.unit,
            itemType: 'FINISHED_GOOD',
            // มูลค่าตลาด — เผื่อฝ่ายบัญชีต้องคิด VAT ของแถม (คำถามค้างในแผน)
            sellingPrice: gift.price,
            isPerishable: false,
            isActive: true,
          },
          select: { id: true },
        }));
      ids[gift.sku] = item.id;

      const stock = await this.prisma.warehouseStock.findFirst({
        where: { warehouseId, itemId: item.id },
        select: { id: true },
      });
      if (!stock) {
        await this.prisma.warehouseStock.create({
          data: { warehouseId, itemId: item.id, quantity: gift.qty, avgCost: gift.cost, totalValue: gift.qty * gift.cost },
        });
      }
    }
    return ids;
  }
}
