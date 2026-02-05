import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// NOTE:
// - platform_admin: SaaS platform admin (ดูแลทุก tenant) → login ผ่าน /admin/login
// - tenant_admin: เจ้าของโรงแรม / ผู้ซื้อ subscription → login ผ่าน /login
// - manager: ผู้จัดการโรงแรม
// - receptionist: พนักงานต้อนรับ / Front Desk
// - housekeeper: แม่บ้าน / Housekeeping
// - chef: เชฟ / หัวหน้าครัว
// - waiter: พนักงานเสิร์ฟ / F&B
// - maintenance: ช่างซ่อมบำรุง
// - accountant: พนักงานบัญชี / การเงิน
// - security: รปภ. / Security
// - staff: พนักงานทั่วไป
// - user: ผู้ใช้ทั่วไป
// - admin: legacy alias (รองรับค่าเดิมใน DB / seed)
export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'manager'
  | 'receptionist'
  | 'housekeeper'
  | 'chef'
  | 'waiter'
  | 'maintenance'
  | 'accountant'
  | 'security'
  | 'staff'
  | 'user'
  | 'admin';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);


