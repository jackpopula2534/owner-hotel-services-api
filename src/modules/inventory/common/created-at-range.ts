import { Prisma } from '@prisma/client';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * ตัวกรองช่วงวันที่สร้างเอกสาร (createdAt) สำหรับหน้ารายการจัดซื้อ
 *
 * - เดิมเขียน `...(startDate && { createdAt: gte })` แล้วตามด้วย
 *   `...(endDate && { createdAt: lte })` — key เดียวกันทับกัน เลือกช่วงวันที่
 *   แล้วเงื่อนไขวันเริ่มหายเงียบ ๆ
 * - วันที่แบบ "YYYY-MM-DD" ตีความเป็นวันตามเวลาไทย และวันสิ้นสุดรวมทั้งวัน
 *   (เดิม lte เที่ยงคืน UTC ตัดเอกสารของวันสุดท้ายทิ้งเกือบทั้งวัน)
 */
export function createdAtRange(
  startDate?: string,
  endDate?: string,
): Prisma.DateTimeFilter | undefined {
  if (!startDate && !endDate) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (startDate) {
    filter.gte = DATE_ONLY.test(startDate)
      ? new Date(`${startDate}T00:00:00+07:00`)
      : new Date(startDate);
  }
  if (endDate) {
    if (DATE_ONLY.test(endDate)) {
      filter.lt = new Date(new Date(`${endDate}T00:00:00+07:00`).getTime() + DAY_MS);
    } else {
      filter.lte = new Date(endDate);
    }
  }
  return filter;
}
