/**
 * ยอดขายรายเมนูในช่วงหนึ่ง
 *
 * ใช้ร่วมกันระหว่างการปิดงวด (เขียนลง `food_cost_analyses`) กับรายงานต้นทุนอาหาร
 * แบบสด ๆ ด้วยเหตุผลเดียวกับ [[room-revenue-by-type]] คือถ้าสองที่นี้คำนวณคนละแบบ
 * ตัวเลขบนหน้าจอเดียวกันจะเปลี่ยนตอนงวดถูกปิด
 *
 * ชุดบิลมาจากสมุดรายได้ (บิลที่ปิดและลงบัญชีแล้วเท่านั้น) แล้วจึงกางรายการในบิล
 * ออกมา ของเดิมกวาดทุก `order` ที่ `createdAt` อยู่ในเดือน โดยไม่ดูสถานะเลย —
 * บิลที่ยกเลิกหรือยังไม่จ่ายก็ถูกนับเป็นยอดขาย
 *
 * ## ตัวหารของ food cost ต้องเป็นเงินที่ได้จริง
 * ยอดรายเมนูเคยเป็นผลบวกราคาหน้าเมนู (`unitPrice × qty`) ซึ่งเป็นยอดก่อนหักส่วนลด
 * ท้ายบิล ตอนที่ต้นทุนวัตถุดิบยังถูกตรึงไว้ที่ 0 ไม่มีใครเห็นผล แต่พอเฟส 4 คิดต้นทุน
 * จริง `foodCostPercent` จะถูกหารด้วยเงินที่ร้านไม่เคยได้รับ ต้นทุนอาหารจึงดูต่ำกว่า
 * ความจริงทุกจานที่อยู่ในบิลที่มีส่วนลด
 *
 * จึงเอา **ยอดสุทธิของบิลตามสมุด** มาเฉลี่ยลงแต่ละจานตามสัดส่วนมูลค่าของบรรทัด —
 * วิธีเดียวกับที่สมุดใช้เฉลี่ยส่วนลดลงแต่ละประเภทรายได้ตอนลงบัญชี เศษสตางค์ที่เหลือ
 * จากการปัดถูกโยนให้บรรทัดที่ใหญ่ที่สุด ผลรวมรายจานจึงเท่ากับยอดของสมุดพอดี
 *
 * นับเฉพาะรายได้ประเภทอาหารกับเครื่องดื่ม — ค่าบริการ (service charge) กับรายได้อื่น
 * ในบิลไม่ใช่ยอดของจานไหน ถ้าโยนเข้าไปรวม food cost จะเพี้ยนอีกทาง
 */
import { RevenueSourceModule, RevenueType } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';

/** ยอดของเมนูหนึ่งรายการในช่วงที่ถาม */
export interface MenuItemSales {
  /** จำนวนที่ขายได้ นับจากบรรทัดในบิลที่อยู่ในสมุด */
  qty: number;
  /** ส่วนแบ่งของ net (= gross − ส่วนลด) ตามสมุด */
  revenue: number;
}

export interface MenuItemSalesScope {
  tenantId: string;
  propertyId: string;
  /** วันธุรกิจไทย 'YYYY-MM-DD' รวมปลายทั้งสองข้าง */
  from: string;
  to: string;
}

export async function menuItemSales(
  prisma: PrismaService,
  revenue: RevenueQueryService,
  scope: MenuItemSalesScope,
): Promise<Map<string, MenuItemSales>> {
  const documents = await revenue.documents({
    tenantId: scope.tenantId,
    propertyId: scope.propertyId,
    from: scope.from,
    to: scope.to,
    sourceModule: RevenueSourceModule.RESTAURANT,
    revenueType: [RevenueType.FOOD, RevenueType.BEVERAGE],
  });

  const byMenuItem = new Map<string, MenuItemSales>();
  if (documents.length === 0) return byMenuItem;

  // บิลหนึ่งอาจมีหลายแถวในสมุด (อาหารแถวหนึ่ง เครื่องดื่มอีกแถวหนึ่ง)
  const netByOrder = new Map<string, number>();
  for (const doc of documents) {
    netByOrder.set(doc.sourceId, round2((netByOrder.get(doc.sourceId) ?? 0) + doc.net));
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: [...netByOrder.keys()] }, tenantId: scope.tenantId },
    select: {
      id: true,
      items: { select: { menuItemId: true, quantity: true, unitPrice: true } },
    },
  });

  for (const order of orders) {
    const lines = order.items.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      value: Number(item.unitPrice) * item.quantity,
    }));
    const lineTotal = lines.reduce((sum, line) => sum + line.value, 0);
    const orderNet = netByOrder.get(order.id) ?? lineTotal;

    // บิลที่ทุกบรรทัดเป็นศูนย์ (ของแถม) เฉลี่ยตามสัดส่วนไม่ได้ ปล่อยให้เป็นศูนย์
    const shares = lines.map((line) =>
      lineTotal > 0 ? round2((line.value / lineTotal) * orderNet) : 0,
    );
    // เศษจากการปัดไปอยู่ที่บรรทัดใหญ่ที่สุด ผลรวมจึงเท่ากับยอดสมุดเป๊ะ
    if (lineTotal > 0) {
      const biggest = lines.reduce(
        (best, line, index) => (line.value > lines[best].value ? index : best),
        0,
      );
      shares[biggest] = round2(
        shares[biggest] + (orderNet - shares.reduce((sum, share) => sum + share, 0)),
      );
    }

    lines.forEach((line, index) => {
      const current = byMenuItem.get(line.menuItemId) ?? { qty: 0, revenue: 0 };
      byMenuItem.set(line.menuItemId, {
        qty: current.qty + line.quantity,
        revenue: round2(current.revenue + shares[index]),
      });
    });
  }

  return byMenuItem;
}
