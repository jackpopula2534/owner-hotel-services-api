import { SetMetadata } from '@nestjs/common';

export type SystemContext =
  | 'main'
  | 'pos'
  | 'procurement'
  | 'warehouse'
  | 'hotel-terminal'
  | 'accounting'
  | 'hr';

export const ALLOW_SYSTEMS_KEY = 'allow_systems';

/**
 * ประกาศว่า endpoint นี้ยอมให้ token ที่ออกจาก **ระบบย่อย** ตัวไหนเรียกได้บ้าง
 *
 * ทิศทางสำคัญ: นี่คือ **allowlist** ไม่ใช่ `@RequireSystem` ของเดิมที่เป็น opt-in
 * restriction — ของเดิมถ้าไม่ติด decorator = ใครก็เข้าได้ แปลว่าลืมติดตรงไหน
 * ตรงนั้นเปิดโล่ง แล้วก็ไม่มีใครติดเลยสักที่เดียวทั้ง repo
 *
 * ตอนนี้ `SystemGuard` เป็น global guard และ default คือ **ปฏิเสธ**:
 * token ที่ `systemContext` อยู่ใน `ENFORCED_SYSTEMS` เข้าได้เฉพาะ endpoint ที่
 * เอ่ยชื่อระบบของตัวเองไว้ตรงนี้เท่านั้น
 *
 * ไม่ต้องใส่ `'main'` — token ของ main dashboard ผ่านทุก endpoint อยู่แล้ว
 * (main คือ superset ระบบย่อยคือส่วนที่ถูกจำกัด)
 *
 * ใช้ที่ระดับ class หรือ handler ก็ได้ handler ชนะ class
 *
 *   @AllowSystems('pos')
 *   @Controller('restaurants/:restaurantId/orders')
 *   export class OrderController {}
 */
export const AllowSystems = (...systems: SystemContext[]) =>
  SetMetadata(ALLOW_SYSTEMS_KEY, systems);
