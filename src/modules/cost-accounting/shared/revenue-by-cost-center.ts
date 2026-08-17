/**
 * รายได้ตามสมุดกลาง ส่องเข้าศูนย์ต้นทุน (cost center) เพื่อทำ P&L รายแผนก
 *
 * ของเดิมการปิดงวดเอา "รายได้" มาจากแถวใน `cost_entries` ที่ประเภทต้นทุนเป็น
 * `REVENUE` — คือให้คนคีย์รายได้เข้ามาเองในตารางต้นทุน กลายเป็นแหล่งความจริงที่สอง
 * ที่ไม่มีอะไรผูกกับยอดขายจริงเลย (ในฐานข้อมูลจริงตอนนี้ต่างกัน 680,000 กับ 18,658)
 * เฟส 3 ทำให้ทุกหน้าจออ่านตัวเงินจากสมุดแล้ว งบรายแผนกจึงต้องมาจากที่เดียวกัน
 *
 * การจับคู่ใช้ **ประเภทของศูนย์ต้นทุน ไม่ใช่ชื่อ** — ชื่อเป็นข้อความอิสระที่ผู้ใช้
 * แก้ได้ (ของจริงตั้งชื่อว่า "Rooms Division" ขณะที่โค้ดเดิมเทียบกับ 'ROOMS' ตรง ๆ
 * จึงไม่เคยแมตช์เลย) ส่วน `CostCenterType` เป็น enum ที่ตรงกับ `RevenueSegment`
 * ตามผัง USALI อยู่แล้ว
 */
import { CostCenterType, RevenueSegment } from '@prisma/client';
import { round2 } from '@/common/utils/bangkok-day.util';
import { PrismaService } from '@/prisma/prisma.service';
import { RevenueQueryService } from '@/modules/revenue/revenue-query.service';

/** แผนกในสมุด ↔ ประเภทศูนย์ต้นทุน — ตรงกันตัวต่อตัวตามผัง USALI */
const SEGMENT_TO_CENTER_TYPE: Record<RevenueSegment, CostCenterType> = {
  [RevenueSegment.ROOMS]: CostCenterType.ROOMS,
  [RevenueSegment.FOOD_BEVERAGE]: CostCenterType.FOOD_BEVERAGE,
  [RevenueSegment.OTHER_OPERATED]: CostCenterType.OTHER_OPERATED,
};

export interface RevenueByCostCenterScope {
  tenantId: string;
  propertyId: string;
  /** วันธุรกิจไทย 'YYYY-MM-DD' รวมปลายทั้งสองข้าง */
  from: string;
  to: string;
}

/** รายได้ของแผนกที่ยังไม่มีศูนย์ต้นทุนรองรับ — เงินที่ลง P&L รายแผนกไม่ได้ */
export interface UnmappedSegmentRevenue {
  segment: RevenueSegment;
  /** ประเภทศูนย์ต้นทุนที่ผู้ใช้ต้องสร้างเพื่อให้เงินก้อนนี้ลงแผนกได้ */
  expectedCostCenterType: CostCenterType;
  revenue: number;
}

export interface RevenueByCostCenter {
  /** costCenterId → รายได้สุทธิตามสมุด (เฉพาะศูนย์ที่จับคู่ได้) */
  byCostCenter: Map<string, number>;
  /**
   * รายได้สุทธิรวมของช่วงนี้ตามสมุด — **ไม่ใช่ผลบวกของ `byCostCenter`**
   *
   * ยอดพาดหัวต้องเป็นยอดของสมุดเสมอ เพื่อให้ตรงกับทุกหน้าจอในเฟส 3 แม้ผู้ใช้จะยัง
   * ไม่ได้สร้างศูนย์ต้นทุนครบทุกแผนก เงินที่ลงแผนกไม่ได้จะโผล่ใน `unmapped`
   * ไม่ใช่หายไปเงียบ ๆ
   */
  total: number;
  unmapped: UnmappedSegmentRevenue[];
}

/**
 * ศูนย์ต้นทุนของแต่ละประเภท — ประเภทหนึ่งอาจมีหลายศูนย์ (สคีมาบังคับ unique แค่
 * code) เลือกตัวที่ `sortOrder` น้อยสุดแล้วตามด้วย `code` เพื่อให้ผลลัพธ์คงที่
 * ไม่เปลี่ยนไปมาตามลำดับที่ฐานข้อมูลคืนมา
 */
function pickCenterByType(
  centers: { id: string; type: CostCenterType; code: string; sortOrder: number }[],
): Map<CostCenterType, string> {
  const sorted = [...centers].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
  const byType = new Map<CostCenterType, string>();
  for (const center of sorted) {
    if (!byType.has(center.type)) byType.set(center.type, center.id);
  }
  return byType;
}

export async function revenueByCostCenter(
  prisma: PrismaService,
  revenue: RevenueQueryService,
  scope: RevenueByCostCenterScope,
): Promise<RevenueByCostCenter> {
  const [segments, centers] = await Promise.all([
    revenue.bySegment({
      tenantId: scope.tenantId,
      propertyId: scope.propertyId,
      from: scope.from,
      to: scope.to,
    }),
    prisma.costCenter.findMany({
      where: { tenantId: scope.tenantId, propertyId: scope.propertyId, isActive: true },
      select: { id: true, type: true, code: true, sortOrder: true },
    }),
  ]);

  const centerByType = pickCenterByType(centers);
  const byCostCenter = new Map<string, number>();
  const unmapped: UnmappedSegmentRevenue[] = [];
  let total = 0;

  for (const group of segments) {
    // `key` ของ bySegment คือชื่อ enum ตรง ๆ
    const segment = group.key as RevenueSegment;
    total = round2(total + group.net);

    const wantedType = SEGMENT_TO_CENTER_TYPE[segment];
    const costCenterId = wantedType ? centerByType.get(wantedType) : undefined;

    if (!costCenterId) {
      unmapped.push({
        segment,
        expectedCostCenterType: wantedType,
        revenue: round2(group.net),
      });
      continue;
    }

    byCostCenter.set(costCenterId, round2((byCostCenter.get(costCenterId) ?? 0) + group.net));
  }

  return { byCostCenter, total, unmapped };
}
