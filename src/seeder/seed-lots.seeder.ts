import { Injectable, Logger } from '@nestjs/common';
import { InventoryLotStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ทำให้ "ของในคลังที่ซีดไว้" มี lot ครบ — ยอด lot รวมต่อ (คลัง, สินค้า) = ยอดคงเหลือในคลัง
 *
 * ปัญหาเดิม: seeder หลายตัวเขียน warehouseStock ตรง ๆ (ร้านค้า/มินิบาร์/ของแถม/คลังลาน)
 * แต่สร้าง lot ให้แค่ไม่กี่ SKU ในคลังร้านของโรงแรม ของที่เหลือจึงมียอดแต่ไม่มี lot
 * พอเบิกสินค้าเน่าเสีย ระบบเลือก lot แบบ FEFO ไม่เจอ → "สต็อก lot ไม่เพียงพอ ต้องการ 5 แต่มีอยู่ 0"
 *
 * ตัวนี้รันท้ายสุดหลังทุก seeder ที่เขียนสต็อก และรันเดี่ยวได้กับ DB ที่ใช้งานอยู่:
 *   npm run seed:lots
 * รันซ้ำได้ — เติม lot ที่ขาด / ตัด lot ที่เกินยอด (เช่นซีดใหม่แล้วยอดคลังถูกรีเซ็ต)
 *
 * ของที่ให้ lot: ของสิ้นเปลือง (สินค้าเน่าเสีย, ติดตาม lot อยู่แล้ว, วัตถุดิบ, สินค้าร้านค้า/ของแถม)
 * ของที่ไม่ให้ lot: ของใช้ซ้ำ/ทรัพย์สิน (อุปกรณ์เช่า ชุดพนักงาน ผ้า) — ไม่มีวันหมดอายุ ไม่ได้ขายออก
 * สินค้าที่ได้ lot จะถูกตั้ง requiresLotTracking = true เพื่อให้การเบิกตัด lot ตามจริง (ยอด lot ไม่เพี้ยน)
 */

/** ของใช้ซ้ำ/ทรัพย์สิน — ไม่ต้องมี lot */
const NO_LOT_SKU_PREFIXES = [
  'RENT-',
  'UNI-',
  'TOWEL-',
  'SHEET-',
  'NAME-TAG',
  'APRON-',
  'SAFETY-',
  'STAFF-CAP',
];
/** ของสิ้นเปลืองที่ขาย/แจกออก — ให้ lot แม้ไม่ได้ตั้งว่าเน่าเสีย */
const LOT_SKU_PREFIXES = ['RT-', 'GIFT-'];

/** ไม่ได้ตั้งอายุการเก็บไว้ — ใช้ค่านี้คำนวณวันหมดอายุของ lot สินค้าเน่าเสีย */
const DEFAULT_SHELF_LIFE_DAYS = 180;
const SEED_NOTE = 'Seed lot — ยอดตั้งต้นจากข้อมูลตัวอย่าง';

export interface SeedLotItem {
  sku: string;
  isPerishable: boolean;
  requiresLotTracking: boolean;
  itemType: string;
  defaultShelfLifeDays: number | null;
}

export interface ExistingLot {
  id: string;
  lotNumber: string;
  remainingQty: number;
  expiryDate: Date | null;
  status: InventoryLotStatus;
}

export interface PlannedLot {
  suffix: string;
  qty: number;
  receivedDaysAgo: number;
  /** null = ไม่มีวันหมดอายุ */
  expiresInDays: number | null;
}

export interface SeedLotPlan {
  create: PlannedLot[];
  /** lot ที่ต้องลดยอด (ยอด lot เกินยอดคลัง) — ตัดจาก lot ใหม่สุดก่อน */
  reduce: Array<{ id: string; remainingQty: number; status: InventoryLotStatus }>;
}

export function itemNeedsSeedLot(item: SeedLotItem): boolean {
  if (NO_LOT_SKU_PREFIXES.some((p) => item.sku.startsWith(p))) return false;
  return (
    item.isPerishable ||
    item.requiresLotTracking ||
    item.itemType === 'RAW_MATERIAL' ||
    LOT_SKU_PREFIXES.some((p) => item.sku.startsWith(p))
  );
}

/** lot ที่ยังมีของ (นับรวมที่หมดอายุ/กักกัน — ของยังอยู่ในคลังจริง) */
const holdsStock = (l: ExistingLot) =>
  l.remainingQty > 0 &&
  l.status !== InventoryLotStatus.EXHAUSTED &&
  l.status !== InventoryLotStatus.DISPOSED;

/**
 * วางแผน lot ให้ (คลัง, สินค้า) หนึ่งคู่ — ยอด lot รวม = stockQty
 * ไม่มี lot เลย + ยอด ≥ 4 → แบ่ง 2 lot (เก่า/ใหม่) ให้เห็น FEFO, ยอดน้อยกว่านั้น → lot เดียว
 * มี lot อยู่แล้วแต่ไม่พอ → เติม lot เดียวเท่าส่วนที่ขาด
 */
export function planSeedLots(
  stockQty: number,
  item: SeedLotItem,
  lots: ExistingLot[],
): SeedLotPlan {
  const live = lots.filter(holdsStock);
  const lotted = live.reduce((s, l) => s + l.remainingQty, 0);
  const shelf = item.isPerishable ? (item.defaultShelfLifeDays ?? DEFAULT_SHELF_LIFE_DAYS) : null;
  const expiry = (receivedDaysAgo: number) => (shelf === null ? null : shelf - receivedDaysAgo);

  if (lotted < stockQty) {
    const gap = stockQty - lotted;
    if (live.length === 0 && gap >= 4) {
      const older = Math.max(1, Math.floor(gap * 0.4));
      // lot เก่ารับมาราว 3/4 ของอายุ (หรือ 45 วันถ้าไม่เน่าเสีย) → ใกล้หมดอายุก่อน ถูกตัดก่อนตาม FEFO
      const oldAge = shelf === null ? 45 : Math.max(1, Math.floor(shelf * 0.75));
      return {
        create: [
          { suffix: 'A', qty: older, receivedDaysAgo: oldAge, expiresInDays: expiry(oldAge) },
          { suffix: 'B', qty: gap - older, receivedDaysAgo: 7, expiresInDays: expiry(7) },
        ],
        reduce: [],
      };
    }
    return {
      create: [
        {
          suffix: live.length === 0 ? 'A' : `T${live.length + 1}`,
          qty: gap,
          receivedDaysAgo: 3,
          expiresInDays: expiry(3),
        },
      ],
      reduce: [],
    };
  }

  if (lotted > stockQty) {
    let excess = lotted - stockQty;
    const reduce: SeedLotPlan['reduce'] = [];
    // ตัดจาก lot ที่หมดอายุช้าสุดก่อน (ของใหม่) — lot เก่าที่ใกล้หมดอายุยังอยู่ให้เห็น FEFO
    const newestFirst = [...live].sort(
      (a, b) => (b.expiryDate?.getTime() ?? Infinity) - (a.expiryDate?.getTime() ?? Infinity),
    );
    for (const l of newestFirst) {
      if (excess <= 0) break;
      const take = Math.min(excess, l.remainingQty);
      const left = l.remainingQty - take;
      reduce.push({
        id: l.id,
        remainingQty: left,
        status: left === 0 ? InventoryLotStatus.EXHAUSTED : l.status,
      });
      excess -= take;
    }
    return { create: [], reduce };
  }

  return { create: [], reduce: [] };
}

@Injectable()
export class SeedLotsSeeder {
  private readonly logger = new Logger(SeedLotsSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ทุก tenant (หรือเฉพาะ tenantId ที่ระบุ) */
  async seed(tenantId?: string): Promise<{ created: number; reduced: number; tracked: number }> {
    this.logger.log('🏷️  Syncing seed lots with warehouse stock...');
    const stocks = await this.prisma.warehouseStock.findMany({
      where: { quantity: { gt: 0 }, ...(tenantId ? { warehouse: { tenantId } } : {}) },
      select: {
        warehouseId: true,
        itemId: true,
        quantity: true,
        avgCost: true,
        warehouse: { select: { tenantId: true, code: true } },
        item: {
          select: {
            sku: true,
            isPerishable: true,
            requiresLotTracking: true,
            itemType: true,
            defaultShelfLifeDays: true,
            deletedAt: true,
          },
        },
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shift = (d: number) => new Date(today.getTime() + d * 86_400_000);

    let created = 0;
    let reduced = 0;
    const lotTracked = new Set<string>();

    for (const s of stocks) {
      const item = s.item;
      if (!item || item.deletedAt) continue;
      const lotItem: SeedLotItem = {
        sku: item.sku,
        isPerishable: item.isPerishable,
        requiresLotTracking: item.requiresLotTracking,
        itemType: String(item.itemType),
        defaultShelfLifeDays: item.defaultShelfLifeDays,
      };
      if (!itemNeedsSeedLot(lotItem)) continue;

      const tId = s.warehouse.tenantId;
      const lots = await this.prisma.inventoryLot.findMany({
        where: { tenantId: tId, itemId: s.itemId, warehouseId: s.warehouseId },
        select: { id: true, lotNumber: true, remainingQty: true, expiryDate: true, status: true },
      });
      const plan = planSeedLots(s.quantity, lotItem, lots);

      for (const p of plan.create) {
        const base = `SEED-${item.sku}-${s.warehouse.code ?? s.warehouseId.slice(0, 6)}-${p.suffix}`;
        // lotNumber unique ต่อ tenant — ถ้าชื่อซ้ำ (เคยซีด/ถูกตัดหมด) ต่อท้ายเลขรอบ
        let lotNumber = base;
        for (
          let n = 2;
          await this.prisma.inventoryLot.findFirst({
            where: { tenantId: tId, lotNumber },
            select: { id: true },
          });
          n++
        ) {
          lotNumber = `${base}${n}`;
        }
        const receivedDate = shift(-p.receivedDaysAgo);
        await this.prisma.inventoryLot.create({
          data: {
            tenantId: tId,
            itemId: s.itemId,
            warehouseId: s.warehouseId,
            lotNumber,
            batchNumber: `${item.sku}-${p.suffix}`,
            receivedDate,
            manufactureDate: receivedDate,
            expiryDate: p.expiresInDays === null ? null : shift(p.expiresInDays),
            initialQty: p.qty,
            remainingQty: p.qty,
            unitCost: s.avgCost,
            status: InventoryLotStatus.ACTIVE,
            notes: SEED_NOTE,
          },
        });
        created++;
      }
      for (const r of plan.reduce) {
        await this.prisma.inventoryLot.update({
          where: { id: r.id },
          data: { remainingQty: r.remainingQty, status: r.status },
        });
        reduced++;
      }
      if (!item.requiresLotTracking) lotTracked.add(s.itemId);
    }

    // ให้การเบิก/ปรับลดตัดจาก lot ตามจริง — ไม่งั้นยอด lot กับยอดคลังจะเพี้ยนกันหลังใช้งาน
    if (lotTracked.size > 0) {
      await this.prisma.inventoryItem.updateMany({
        where: { id: { in: [...lotTracked] } },
        data: { requiresLotTracking: true },
      });
    }

    this.logger.log(
      `  ✓ lots created ${created} · lots trimmed ${reduced} · items set to lot tracking ${lotTracked.size}`,
    );
    return { created, reduced, tracked: lotTracked.size };
  }
}
