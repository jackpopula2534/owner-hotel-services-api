import {
  RevenueSourceModule,
  RevenueSourceType,
  RevenueType,
} from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import type { PostRevenueInput, RevenueLineInput } from '../revenue-posting.service';
import { allocateProRata } from '../revenue-allocation.util';
import { settlementOf } from './settlement.util';
import { num, type Money } from './money';

/**
 * ชนิดรายได้ที่หมวดเมนูตั้งได้ — API ปฏิเสธค่านอกชุดนี้
 *
 * คอลัมน์ในฐานข้อมูลใช้ enum `RevenueType` ทั้งใบเพื่อให้พูดภาษาเดียวกับสมุดรายได้
 * แต่ในทางธุรกิจหมวดเมนูเป็นได้แค่สามอย่างนี้ ถ้าปล่อยให้ตั้ง ROOM ได้ เงินค่าอาหาร
 * จะไหลไปกองในแผนกห้องพัก — บั๊กชนิดเดียวกับที่ทั้งงานนี้กำลังตามแก้
 */
export const MENU_REVENUE_TYPES: readonly RevenueType[] = Object.freeze([
  RevenueType.FOOD,
  RevenueType.BEVERAGE,
  RevenueType.OTHER,
]);

/**
 * ชนิดรายได้ของหมวดเมนู โดยกันค่าที่หลุดออกนอกชุดที่ยอมรับ
 *
 * ค่าที่หลุดมาได้ก็ต่อเมื่อมีคนเขียนฐานข้อมูลตรง ๆ — ตกกลับเป็น FOOD ดีกว่าปล่อยผ่าน
 * หรือโยน error แล้วปิดบิลไม่ได้ทั้งร้าน
 */
export const menuRevenueTypeOf = (value: RevenueType | null | undefined): RevenueType =>
  value && MENU_REVENUE_TYPES.includes(value) ? value : RevenueType.FOOD;

/** แถว Order เท่าที่การบันทึกรายได้ต้องใช้ (ตรงกับ ORDER_REVENUE_SELECT) */
export interface OrderRevenueRow {
  id: string;
  tenantId: string | null;
  orderNumber: string;
  restaurantId: string;
  paymentMethod: string | null;
  paymentStatus: string;
  folioChargeId: string | null;
  subtotal: Money;
  discount: Money;
  serviceCharge: Money;
  taxAmount: Money;
  total: Money;
  completedAt: Date | null;
  createdAt: Date;
  items: {
    status: string;
    totalPrice: Money;
    menuItem: { category: { revenueType: RevenueType | null } | null } | null;
  }[];
}

/** ข้อมูลร้านที่แถว Order ไม่ได้ถืออยู่เอง */
export interface OrderRevenueOutlet {
  restaurantId: string;
  restaurantName: string | null;
  propertyId: string | null;
}

/** สิ่งที่ Prisma ต้อง select มาให้ {@link buildOrderRevenueInput} ทำงานได้ */
export const ORDER_REVENUE_SELECT = {
  id: true,
  tenantId: true,
  orderNumber: true,
  restaurantId: true,
  paymentMethod: true,
  paymentStatus: true,
  folioChargeId: true,
  subtotal: true,
  discount: true,
  serviceCharge: true,
  taxAmount: true,
  total: true,
  completedAt: true,
  createdAt: true,
  items: {
    select: {
      status: true,
      totalPrice: true,
      menuItem: { select: { category: { select: { revenueType: true } } } },
    },
  },
} as const;

/**
 * แปลงบิลร้านอาหารหนึ่งใบเป็นรายการรายได้ที่พร้อมลงสมุด
 *
 * เป็นฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล เพราะทั้งตอนปิดบิลจริงและตอน backfill
 * ย้อนหลังต้องได้ตัวเลขชุดเดียวกันเป๊ะ ถ้าเขียนแยกสองที่ วันหนึ่งจะแก้ที่เดียว
 * แล้วยอดที่ backfill ไว้กับยอดที่ปิดบิลใหม่จะไม่ตรงกันโดยไม่มีอะไรฟ้อง
 *
 * ── การแตกยอด ──────────────────────────────────────────────────────────────
 * `subtotal` ถูกแบ่งตามสัดส่วนยอดของรายการอาหารในแต่ละชนิดรายได้ (อาหาร/เครื่องดื่ม
 * ตามที่หมวดเมนูกำหนด) **ไม่ใช่** บวกยอดรายการตรง ๆ เพราะคอลัมน์เงินของบิลคือ
 * ตัวจริงที่ลูกค้าจ่าย ส่วนยอดรายการเป็นแค่ตัวบอกสัดส่วน ถ้าสองอย่างไม่ตรงกัน
 * (บิลถูกแก้ยอดด้วยมือ) ยอดในสมุดต้องเท่ากับที่เก็บเงินได้เสมอ
 *
 * ส่วนลดเฉลี่ยตามสัดส่วนเดียวกัน ค่าบริการแยกเป็นบรรทัดของตัวเอง (segmentOf พาไป
 * ลง F&B ให้เอง) และ VAT เฉลี่ยตามฐานภาษีจริงของแต่ละบรรทัด — ฐาน VAT ของบิล
 * ร้านอาหารคือ net + ค่าบริการ ค่าบริการจึงต้องมีส่วนแบ่ง VAT ด้วย
 *
 * ผลลัพธ์: ผลรวม `totalAmount` ของทุกบรรทัด = `order.total` เป๊ะทุกใบ
 */
export function buildOrderRevenueInput(
  order: OrderRevenueRow,
  outlet: OrderRevenueOutlet,
): PostRevenueInput {
  const tenantId = order.tenantId ?? '';
  const subtotal = round2(num(order.subtotal));
  const discount = round2(num(order.discount));
  const serviceCharge = round2(num(order.serviceCharge));
  const taxAmount = round2(num(order.taxAmount));

  // รายการที่ถูกยกเลิกกลางคันไม่เคยถูกคิดเงิน จึงไม่ควรมีน้ำหนักในการแบ่งยอด
  const grossByType = new Map<RevenueType, number>();
  for (const item of order.items ?? []) {
    if (item.status === 'CANCELLED') continue;
    const type = menuRevenueTypeOf(item.menuItem?.category?.revenueType);
    grossByType.set(type, round2((grossByType.get(type) ?? 0) + num(item.totalPrice)));
  }

  // บิลที่ไม่มีรายการเหลือเลยแต่ยังมียอด (รายการถูกยกเลิกหมดหลังปิดบิล หรือข้อมูลเก่า
  // ที่ไม่มี order_items) — ยังต้องลงบัญชี ให้ตกเป็นอาหารซึ่งเป็นค่าปกติของร้าน
  if (grossByType.size === 0) grossByType.set(RevenueType.FOOD, subtotal);

  const types = [...grossByType.keys()];
  const weights = types.map((type) => grossByType.get(type) ?? 0);

  const grossShare = allocateProRata(subtotal, weights);
  const discountShare = allocateProRata(discount, weights);

  // ฐานภาษีของแต่ละบรรทัด = ยอดสุทธิของบรรทัดนั้น และค่าบริการก็เป็นฐานภาษีด้วย
  const netShare = grossShare.map((gross, i) => round2(gross - discountShare[i]));
  const taxWeights = serviceCharge > 0 ? [...netShare, serviceCharge] : netShare;
  const taxShare = allocateProRata(taxAmount, taxWeights);

  const lines: RevenueLineInput[] = types.map((revenueType, i) => ({
    revenueType,
    grossAmount: grossShare[i],
    discount: discountShare[i],
    taxAmount: taxShare[i],
  }));

  if (serviceCharge > 0) {
    lines.push({
      revenueType: RevenueType.SERVICE_CHARGE,
      grossAmount: serviceCharge,
      taxAmount: taxShare[taxShare.length - 1],
    });
  }

  return {
    tenantId,
    propertyId: outlet.propertyId,
    sourceModule: RevenueSourceModule.RESTAURANT,
    sourceType: RevenueSourceType.ORDER,
    sourceId: order.id,
    documentNo: order.orderNumber,
    // เวลาปิดบิลคือเวลาที่รายได้เกิด ไม่ใช่เวลาที่เปิดโต๊ะ — โต๊ะที่นั่งข้ามเที่ยงคืน
    // ต้องเป็นยอดของวันที่จ่ายเงิน ตรงกับที่นับเงินในลิ้นชักตอนปิดร้าน
    occurredAt: order.completedAt ?? order.createdAt,
    outletId: outlet.restaurantId,
    outletName: outlet.restaurantName,
    settlement:
      order.paymentStatus === 'CHARGED_TO_ROOM'
        ? settlementOf('room_charge')
        : settlementOf(order.paymentMethod),
    folioChargeId: order.folioChargeId,
    lines,
  };
}
