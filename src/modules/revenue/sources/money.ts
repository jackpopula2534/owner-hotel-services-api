/**
 * ค่าเงินอย่างที่มันมาจาก Prisma จริง ๆ
 *
 * คอลัมน์ Decimal ถูกส่งกลับมาเป็น object `Prisma.Decimal` เวลาอ่านผ่าน client
 * แต่เป็น string เวลามาจาก `$queryRaw` และเป็น number เวลามาจากเทสต์ ตัวแปลงตัวนี้
 * รับได้หมดเพื่อให้ตัวแปลงเอกสารต้นทางเขียนครั้งเดียวใช้ได้ทั้งของจริงและของปลอม
 */
export type Money = { toString(): string } | number | string | null | undefined;

/** ค่าเงินเป็น number — ค่าว่าง/แปลงไม่ได้ = 0 (ยอดขายไม่มีค่า NaN) */
export const num = (value: Money): number => {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
};
