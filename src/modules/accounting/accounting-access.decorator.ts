import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY, UserRole } from '@/common/decorators/roles.decorator';

/**
 * สิทธิ์ของโมดูลบัญชี (สมุดรายวัน/ลูกหนี้/เจ้าหนี้/สินทรัพย์/ภาษี/เงินสด/night audit)
 *
 * เดิม controller บัญชีทั้ง 18 ตัวมีแค่ JwtAuthGuard + AddonGuard — ใครก็ตามที่ล็อกอิน
 * tenant ที่ซื้อ ACCOUNTING_MODULE ได้ (แม่บ้าน, รปภ., พนักงานเสิร์ฟ) อ่านงบ ลงสมุดรายวัน
 * กลับรายการ หรือปิดปีบัญชีได้หมด
 *
 * ระวังเรื่อง RolesGuard: ลิสต์ที่มี role ที่มีอันดับต่ำ จะลด "พื้นการสืบทอด" ของทั้งลิสต์
 * ลงไปด้วย (เช่นใส่ `receptionist` = level 50 → พนักงานเสิร์ฟ level 50 เข้าได้ทันที)
 * role ฝั่งบัญชีทุกตัวจึงต้อง **ไม่มีอันดับ** ใน ROLE_LEVELS (เข้าได้ด้วย exact match เท่านั้น)
 * ส่วนพื้นการสืบทอดของทุกลิสต์ = manager (80) → admin/tenant_admin/platform_admin สืบทอดเข้าได้
 */
const MANAGEMENT_ROLES: readonly UserRole[] = [
  'platform_admin',
  'tenant_admin',
  'admin',
  'manager',
  'owner',
  // token จากปุ่ม "เปิดระบบบัญชี" ของ dashboard (auth.service generateAccountingLaunchToken)
  'accounting_manager',
];

/** หัวหน้าบัญชี — ปิด/ล็อกปีบัญชี อนุมัติกระทบยอด ยื่นภาษี กลับรายการ */
export const ACCOUNTING_CLOSE_ROLES: readonly UserRole[] = [...MANAGEMENT_ROLES, 'chief_accountant'];

/** ลงรายการบัญชีทั่วไป */
export const ACCOUNTING_WRITE_ROLES: readonly UserRole[] = [...ACCOUNTING_CLOSE_ROLES, 'accountant'];

export const AR_WRITE_ROLES: readonly UserRole[] = [...ACCOUNTING_WRITE_ROLES, 'ar_clerk'];
export const AP_WRITE_ROLES: readonly UserRole[] = [...ACCOUNTING_WRITE_ROLES, 'ap_clerk'];

/** อ่านอย่างเดียว — รวมผู้ตรวจสอบ (auditor) และพนักงานลูกหนี้/เจ้าหนี้ */
export const ACCOUNTING_READ_ROLES: readonly UserRole[] = [
  ...ACCOUNTING_WRITE_ROLES,
  'ar_clerk',
  'ap_clerk',
  'auditor',
];

/**
 * ติดที่ระดับ class (คู่กับ `@UseGuards(JwtAuthGuard, RolesGuard, ...)`)
 * - GET → ACCOUNTING_READ_ROLES
 * - method อื่น → `writeRoles`
 * - method ที่ติด `@Roles(...)` เองอยู่แล้ว → ใช้ของ method (เช่นงานปิดงวดที่ต้องเป็นหัวหน้า)
 *
 * ทำเป็น decorator แทนการติด @Roles ทีละ method เพราะ endpoint ใหม่ที่ลืมติด
 * จะได้สิทธิ์ตามค่าเริ่มต้นนี้ ไม่ใช่เปิดโล่งเหมือนเดิม
 */
export function AccountingAccess(
  writeRoles: readonly UserRole[] = ACCOUNTING_WRITE_ROLES,
): ClassDecorator {
  return (target) => {
    const proto = target.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      const handler = proto[key];
      if (key === 'constructor' || typeof handler !== 'function') continue;

      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined || Reflect.hasMetadata(ROLES_KEY, handler)) continue;

      const roles = method === RequestMethod.GET ? ACCOUNTING_READ_ROLES : writeRoles;
      Reflect.defineMetadata(ROLES_KEY, [...roles], handler);
    }
  };
}
