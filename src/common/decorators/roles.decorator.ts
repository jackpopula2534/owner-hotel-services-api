import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// NOTE:
// - platform_admin: SaaS platform admin (ดูแลทุก tenant)
// - tenant_admin: เจ้าของโรงแรม / ผู้ซื้อ subscription
// - manager: ผู้จัดการโรงแรม
// - staff: พนักงานทั่วไป (แม่บ้าน, เสิร์ฟ, ช่างซ่อม ฯลฯ)
// - user: ผู้ใช้ทั่วไป
// - admin: legacy alias (รองรับค่าเดิมใน DB / seed)
export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'manager'
  | 'staff'
  | 'user'
  | 'admin';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);


