import { ForbiddenException } from '@nestjs/common';

/**
 * ใครทำอะไรกับคำขอสินค้าได้
 *
 * เช็คแบบ exact match (ไม่ใช้ลำดับขั้นของ RolesGuard) เพราะ warehouse_manager ไม่มี level
 * และ procurement_manager มี level 75 ซึ่งถ้าใช้ hierarchy จะ "อนุมัติฝั่งคลัง" ได้ด้วย
 * — ผิดหลักแบ่งแยกหน้าที่ (segregation of duties) ที่ฟีเจอร์นี้ตั้งใจสร้าง
 */
const OWNER_ROLES = ['platform_admin', 'admin', 'tenant_admin', 'owner', 'manager'] as const;

export const REQUESTER_ROLES: ReadonlySet<string> = new Set([
  ...OWNER_ROLES,
  'procurement_manager',
  'buyer',
]);

export const REVIEWER_ROLES: ReadonlySet<string> = new Set([...OWNER_ROLES, 'warehouse_manager']);

export const VIEWER_ROLES: ReadonlySet<string> = new Set([
  ...REQUESTER_ROLES,
  ...REVIEWER_ROLES,
  'approver',
  'receiver',
  'inventory_clerk',
  'qc_officer',
]);

/**
 * ผู้ดูแลที่ส่งคำขอเองแล้วอนุมัติเองได้ (โรงแรมเล็กที่เจ้าของทำทุกอย่าง)
 * ไม่รวม `manager` (GM) — ตรงกับ SELF_APPROVE_ROLES ของ PR/PO ใน common/approval-access.ts
 */
/** เจ้าของ/ผู้ดูแล (รวม GM) — แก้ข้อมูลที่จัดซื้อเป็นเจ้าของได้ตรง ๆ กรณีเร่งด่วน, ยกเลิก/ส่งซ้ำคำขอของคนอื่นได้ */
export const DIRECT_EDIT_ROLES: ReadonlySet<string> = new Set(OWNER_ROLES);

export const SELF_REVIEW_ROLES: ReadonlySet<string> = new Set(
  OWNER_ROLES.filter((r) => r !== 'manager'),
);

/**
 * role ของระบบจัดซื้อที่ห้ามสร้าง/แก้สินค้าตรงๆ — ต้องส่งคำขอให้คลังแทน
 * (`receiver` ไม่อยู่ในนี้เพราะเป็น role ของฝั่งคลังด้วย)
 */
export const PROCUREMENT_ONLY_ROLES: ReadonlySet<string> = new Set([
  'procurement_manager',
  'buyer',
  'approver',
]);

export interface ChangeRequestActor {
  userId: string;
  tenantId: string;
  role: string;
}

export function assertRole(
  actor: ChangeRequestActor,
  allowed: ReadonlySet<string>,
  action: string,
): void {
  if (!actor.tenantId) {
    throw new ForbiddenException('No active tenant');
  }
  if (!allowed.has(actor.role)) {
    throw new ForbiddenException(`บทบาท ${actor.role} ไม่มีสิทธิ์${action}`);
  }
}

export function assertNotProcurementOnly(role: string | undefined): void {
  if (role && PROCUREMENT_ONLY_ROLES.has(role)) {
    throw new ForbiddenException({
      code: 'ITEM_MASTER_WAREHOUSE_ONLY',
      message: 'สินค้าสร้าง/แก้ไขได้จากฝั่งคลังเท่านั้น — ฝ่ายจัดซื้อให้ส่ง "คำขอสินค้า" แทน',
    });
  }
}

/** ช่องของ inventory_items ที่จัดซื้อเป็นเจ้าของ (แก้ผ่านคำขอสินค้าเท่านั้น) */
const PROCUREMENT_OWNED_ITEM_FIELDS = ['name', 'description', 'brand'] as const;

type ProcurementOwnedItemField = (typeof PROCUREMENT_OWNED_ITEM_FIELDS)[number];

const normText = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * ผู้ใช้ฝั่งคลังแก้สินค้าได้ แต่ห้ามเปลี่ยนชื่อ/สเปก/ยี่ห้อเอง — ข้อมูลส่วนนี้จัดซื้อเป็นเจ้าของ
 * เจ้าของ/ผู้ดูแลระบบยังแก้ตรงได้ (แก้ปัญหาเร่งด่วน) ฟอร์มที่ส่งค่าเดิมกลับมาทั้งก้อนไม่โดนบล็อก
 * เพราะเทียบเฉพาะค่าที่ "เปลี่ยนจริง"
 */
export function assertProcurementOwnedFieldsUnchanged(
  role: string | undefined,
  current: Record<ProcurementOwnedItemField, string | null>,
  incoming: Partial<Record<ProcurementOwnedItemField, string | null>>,
): void {
  if (role && DIRECT_EDIT_ROLES.has(role)) return;
  const changed = PROCUREMENT_OWNED_ITEM_FIELDS.filter(
    (f) => incoming[f] !== undefined && normText(incoming[f]) !== normText(current[f]),
  );
  if (changed.length > 0) {
    throw new ForbiddenException({
      code: 'ITEM_FIELD_OWNED_BY_PROCUREMENT',
      message: `ชื่อ/สเปก/ยี่ห้อ จัดซื้อเป็นเจ้าของข้อมูล — ให้ฝ่ายจัดซื้อส่ง "คำขอแก้ไขสินค้า" (${changed.join(', ')})`,
    });
  }
}

/**
 * ราคา/MOQ/Supplier หลักของสินค้า (item_suppliers) — จัดซื้อเป็นเจ้าของ เปลี่ยนผ่านคำขอสินค้า
 * เขียนตรงได้เฉพาะเจ้าของ/ผู้ดูแลระบบ
 */
export function assertCanWriteItemSuppliers(role: string | undefined): void {
  if (!role || !DIRECT_EDIT_ROLES.has(role)) {
    throw new ForbiddenException({
      code: 'ITEM_SUPPLIER_VIA_CHANGE_REQUEST',
      message:
        'Supplier / ราคาซื้อของสินค้าเปลี่ยนผ่าน "คำขอสินค้า" (จัดซื้อส่ง → คลังรับทราบ) เท่านั้น',
    });
  }
}
