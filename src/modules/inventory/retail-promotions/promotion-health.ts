import { RetailPromoDiscountType } from '@prisma/client';

/**
 * สุขภาพของโปรโมชั่น — ของแถม/งบ/โควตาเหลือพอแจกอีกกี่บิล
 *
 * pure function ล้วน ไม่แตะ DB — service โหลดข้อมูลมาแล้วส่งเข้ามา
 * ทั้งหน้าแจ้งเตือนและ auto-pause หลังขายใช้สูตรเดียวกันนี้ ตัวเลขจึงไม่มีทางขัดกัน
 */

/** เหลือแจกได้ไม่เกินกี่บิลถึงเรียกว่า "ใกล้หมด" */
export const LOW_GIFT_RUNS = 10;
/** งบของแถมเหลือไม่เกินสัดส่วนนี้ของงบทั้งหมด = ใกล้หมด */
export const LOW_BUDGET_RATIO = 0.2;
/** โควตาใช้โปรเหลือไม่เกินสัดส่วนนี้ (อย่างน้อย LOW_USAGE_MIN ครั้ง) = ใกล้เต็ม */
export const LOW_USAGE_RATIO = 0.1;
export const LOW_USAGE_MIN = 5;

export type PromoAlertKind = 'GIFT_OUT' | 'GIFT_LOW' | 'USAGE_FULL' | 'USAGE_LOW';
export type PromoAlertSeverity = 'critical' | 'warning';
/** อะไรเป็นตัวจำกัด — ของในคลังของแถม หรืองบที่ตั้งไว้ในโปร */
export type GiftLimitedBy = 'STOCK' | 'BUDGET';

export interface HealthGift {
  itemId: string;
  name: string;
  unit: string;
  /** จำนวนที่แจกต่อบิล */
  quantity: number;
  budgetQty: number | null;
  issuedQty: number;
  /** คงเหลือในคลังของแถมของโปรนี้ */
  stockQty: number;
}

export interface HealthPromotion {
  id: string;
  name: string;
  discountType: RetailPromoDiscountType;
  usageLimit: number | null;
  usedCount: number;
}

export interface GiftRuns {
  /** แจกได้อีกกี่บิล */
  runs: number;
  limitedBy: GiftLimitedBy;
  /** ชิ้นที่เหลือตามตัวจำกัด */
  remainingQty: number;
}

export interface PromoAlert {
  promotionId: string;
  promotionName: string;
  kind: PromoAlertKind;
  severity: PromoAlertSeverity;
  /** แจก/ใช้ได้อีกกี่บิล */
  remainingRuns: number;
  giftItemId?: string;
  giftName?: string;
  limitedBy?: GiftLimitedBy;
  message: string;
}

export function giftRuns(gift: HealthGift): GiftRuns {
  const perBill = Math.max(1, gift.quantity);
  const stock = Math.max(0, Math.floor(gift.stockQty));
  const budget = gift.budgetQty != null ? Math.max(0, gift.budgetQty - gift.issuedQty) : null;
  // งบเท่ากับสต็อกพอดี → โทษงบ: แก้งบได้ทันทีในหน้าโปร ส่วนสต็อกต้องโอนเข้าคลัง
  const limitedBy: GiftLimitedBy = budget != null && budget <= stock ? 'BUDGET' : 'STOCK';
  const remainingQty = limitedBy === 'BUDGET' ? (budget as number) : stock;
  return { runs: Math.floor(remainingQty / perBill), limitedBy, remainingQty };
}

function isGiftLow(gift: HealthGift, runs: GiftRuns): boolean {
  if (runs.runs <= LOW_GIFT_RUNS) return true;
  if (runs.limitedBy === 'BUDGET' && gift.budgetQty) {
    return runs.remainingQty <= gift.budgetQty * LOW_BUDGET_RATIO;
  }
  return false;
}

export function assessPromotion(promo: HealthPromotion, gifts: HealthGift[]): PromoAlert[] {
  const alerts: PromoAlert[] = [];
  const base = { promotionId: promo.id, promotionName: promo.name };

  for (const gift of gifts) {
    const runs = giftRuns(gift);
    const source = runs.limitedBy === 'BUDGET' ? 'งบของแถม' : 'คลังของแถม';
    const giftBase = { ...base, giftItemId: gift.itemId, giftName: gift.name, limitedBy: runs.limitedBy };
    if (runs.runs === 0) {
      alerts.push({
        ...giftBase,
        kind: 'GIFT_OUT',
        severity: 'critical',
        remainingRuns: 0,
        message:
          runs.limitedBy === 'BUDGET'
            ? `งบของแถม "${gift.name}" หมดแล้ว — เพิ่มงบในโปรถ้าต้องการแจกต่อ`
            : `"${gift.name}" ในคลังของแถมหมดแล้ว — โอนสต็อกเข้าคลังของแถม`,
      });
    } else if (isGiftLow(gift, runs)) {
      alerts.push({
        ...giftBase,
        kind: 'GIFT_LOW',
        severity: 'warning',
        remainingRuns: runs.runs,
        message: `"${gift.name}" ใกล้หมด — ${source}เหลือ ${runs.remainingQty} ${gift.unit} (แจกได้อีก ${runs.runs} บิล)`,
      });
    }
  }

  if (promo.usageLimit != null) {
    const left = Math.max(0, promo.usageLimit - promo.usedCount);
    const lowAt = Math.max(LOW_USAGE_MIN, Math.ceil(promo.usageLimit * LOW_USAGE_RATIO));
    if (left === 0) {
      alerts.push({ ...base, kind: 'USAGE_FULL', severity: 'critical', remainingRuns: 0, message: 'โปรนี้ถูกใช้ครบโควตาแล้ว' });
    } else if (left <= lowAt) {
      alerts.push({
        ...base,
        kind: 'USAGE_LOW',
        severity: 'warning',
        remainingRuns: left,
        message: `โควตาโปรใกล้เต็ม — ใช้ได้อีก ${left} ครั้ง (จาก ${promo.usageLimit})`,
      });
    }
  }
  return alerts;
}

/**
 * โปรที่ "ไม่มีส่วนลด" แจกของแถมอย่างเดียว — ของแถมตัวใดหมด โค้ดก็ใช้ไม่ได้อีกแล้ว
 * (ลูกค้าเลือก "รับเฉพาะส่วนลด" ไม่ได้เพราะไม่มีส่วนลดให้รับ) จึงหยุดโปรให้เลย
 * โปรที่มีส่วนลดไม่หยุด — ลูกค้ายังเลือกรับเฉพาะส่วนลดได้ตามกติกาเฟส 1
 */
export function shouldAutoPause(promo: HealthPromotion, gifts: HealthGift[]): string | null {
  if (promo.discountType !== RetailPromoDiscountType.NONE || gifts.length === 0) return null;
  const out = gifts.find((g) => giftRuns(g).runs === 0);
  if (!out) return null;
  const runs = giftRuns(out);
  return runs.limitedBy === 'BUDGET'
    ? `งบของแถม "${out.name}" หมด — โปรแจกของแถมอย่างเดียวจึงหยุดอัตโนมัติ`
    : `"${out.name}" ในคลังของแถมหมด — โปรแจกของแถมอย่างเดียวจึงหยุดอัตโนมัติ`;
}
