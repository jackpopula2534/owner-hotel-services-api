import { round2 } from '@/common/utils/bangkok-day.util';

/**
 * แบ่งยอดรวมก้อนเดียวลงหลายบรรทัดตามสัดส่วน โดยผลรวมต้องเท่ากับยอดตั้งต้น "เป๊ะ"
 *
 * เอกสารต้นทางเก็บส่วนลดและ VAT ไว้เป็นยอดรวมของทั้งบิล แต่สมุดรายได้เก็บทีละ
 * ชนิดรายได้ ตอนแตกบรรทัดจึงต้องเฉลี่ยยอดพวกนี้ลงไป
 *
 * ที่ต้องมีฟังก์ชันนี้แทนการคูณสัดส่วนตรง ๆ คือ **เศษการปัด**: บิล 100 บาท
 * ส่วนลด 10 บาท แบ่งเป็นอาหาร 1 ใน 3 กับเครื่องดื่ม 2 ใน 3 ถ้าปัดแยกกันจะได้
 * 3.33 + 6.67 = 10.00 พอดี แต่ 3 ทาง ๆ ละ 1 ใน 3 จะได้ 3.33 × 3 = 9.99 —
 * หายไป 1 สตางค์ทุกใบ วันละร้อยใบก็เป็นเงินที่ไม่มีวันกระทบยอดตรง
 *
 * เศษที่เหลือถูกยกไปให้บรรทัดที่ตุ้มน้ำหนักมากที่สุด เพราะเป็นบรรทัดที่ผิดเป็น
 * เปอร์เซ็นต์น้อยที่สุด และเลือกแบบ deterministic (ตัวแรกชนะเมื่อเท่ากัน) เพื่อให้
 * ยิงซ้ำได้ผลเดิมทุกครั้ง ไม่งั้น idempotency ของสมุดรายได้จะพังเพราะเลขขยับเอง
 *
 * @param amount  ยอดที่ต้องแบ่ง (≥ 0)
 * @param weights ตุ้มน้ำหนักของแต่ละบรรทัด (≥ 0) — ปกติคือยอดขายก่อนหักของบรรทัดนั้น
 * @returns ยอดที่แต่ละบรรทัดได้รับ ผลรวม = round2(amount) เสมอ
 */
export function allocateProRata(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const target = round2(amount);
  if (weights.some((w) => w < 0)) {
    throw new Error(`allocateProRata: ตุ้มน้ำหนักติดลบ (${weights.join(', ')})`);
  }
  if (target === 0) return weights.map(() => 0);

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // ทุกบรรทัดน้ำหนักศูนย์แต่ยังมีเงินให้แบ่ง (บิลที่ยอดขายเป็น 0 แต่มีค่าบริการ)
  // — ไม่มีสัดส่วนให้อ้าง จึงกองไว้บรรทัดแรกทั้งก้อน ดีกว่าทำเงินหาย
  if (totalWeight === 0) return weights.map((_, i) => (i === 0 ? target : 0));

  const allocated = weights.map((w) => round2((target * w) / totalWeight));
  const residue = round2(target - allocated.reduce((sum, a) => sum + a, 0));

  if (residue !== 0) {
    let heaviest = 0;
    for (let i = 1; i < weights.length; i += 1) {
      if (weights[i] > weights[heaviest]) heaviest = i;
    }
    allocated[heaviest] = round2(allocated[heaviest] + residue);
  }

  return allocated;
}
