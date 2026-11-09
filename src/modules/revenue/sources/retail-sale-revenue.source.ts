import { RevenueSourceModule, RevenueSourceType, RevenueType } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import type { PostRevenueInput } from '../revenue-posting.service';
import { settlementOf } from './settlement.util';
import { num, type Money } from './money';

/** แถว RetailSale เท่าที่การบันทึกรายได้ต้องใช้ */
export interface RetailSaleRevenueRow {
  id: string;
  tenantId: string;
  receiptNo: string;
  warehouseId: string;
  paymentMethod: string;
  folioChargeId: string | null;
  subtotal: Money;
  discountTotal: Money;
  vatAmount: Money;
  soldAt: Date;
}

/** ข้อมูลร้าน/คลังที่แถว RetailSale ไม่ได้ถืออยู่เอง */
export interface RetailSaleOutlet {
  warehouseId: string;
  warehouseName: string | null;
  propertyId: string | null;
}

/** สิ่งที่ Prisma ต้อง select มาให้ {@link buildRetailSaleRevenueInput} ทำงานได้ */
export const RETAIL_SALE_REVENUE_SELECT = {
  id: true,
  tenantId: true,
  receiptNo: true,
  warehouseId: true,
  paymentMethod: true,
  folioChargeId: true,
  subtotal: true,
  discountTotal: true,
  vatAmount: true,
  soldAt: true,
} as const;

/**
 * แปลงใบเสร็จร้านค้าหนึ่งใบเป็นรายการรายได้ที่พร้อมลงสมุด
 *
 * ร้านค้าขายสินค้าอย่างเดียว จึงมีบรรทัดเดียวเสมอ ไม่ต้องแตกตามชนิด — ต่างจาก
 * ร้านอาหารที่ต้องแยกอาหารกับเครื่องดื่มเพื่อคิด Food Cost%
 *
 * `RETAIL_GOODS` ตกลง segment `OTHER_OPERATED` ตามผัง USALI: ร้านขายของในโรงแรม
 * เป็นแผนกที่ดำเนินการเอง ไม่ใช่ห้องพักและไม่ใช่ครัว ถ้าเอาไปรวมกับ F&B ตัวหาร
 * ของ Food Cost% จะโตขึ้นด้วยยอดขายน้ำอัดลมในตู้แช่ แล้วเปอร์เซ็นต์จะดูดีเกินจริง
 *
 * ยอดที่เก็บ: `subtotal` เป็นยอดก่อนหักส่วนลด `discountTotal` เป็นส่วนลดรวมทั้งใบ
 * (รวมส่วนลดรายบรรทัดแล้ว ตามที่ RetailSalesService คิดไว้) VAT แยกไว้ต่างหาก
 * ผลรวม `totalAmount` = `grandTotal` ของใบเสร็จเป๊ะ
 */
export function buildRetailSaleRevenueInput(
  sale: RetailSaleRevenueRow,
  outlet: RetailSaleOutlet,
): PostRevenueInput {
  return {
    tenantId: sale.tenantId,
    propertyId: outlet.propertyId,
    sourceModule: RevenueSourceModule.RETAIL,
    sourceType: RevenueSourceType.RETAIL_SALE,
    sourceId: sale.id,
    documentNo: sale.receiptNo,
    occurredAt: sale.soldAt,
    outletId: outlet.warehouseId,
    outletName: outlet.warehouseName,
    settlement: settlementOf(sale.paymentMethod),
    folioChargeId: sale.folioChargeId,
    lines: [
      {
        revenueType: RevenueType.RETAIL_GOODS,
        grossAmount: round2(num(sale.subtotal)),
        discount: round2(num(sale.discountTotal)),
        taxAmount: round2(num(sale.vatAmount)),
      },
    ],
  };
}
