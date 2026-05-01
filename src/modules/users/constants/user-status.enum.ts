/**
 * Lifecycle status สำหรับบัญชีผู้ใช้ (User.status)
 *
 * - ACTIVE     : ใช้งานได้ปกติ
 * - INACTIVE   : ปิดใช้งานชั่วคราว (deactivate) — admin สามารถเปิดกลับได้
 * - SUSPENDED  : ถูกระงับโดย admin (มี suspendedReason / suspendedBy)
 * - EXPIRED   : หมดอายุการใช้งาน (อัตโนมัติเมื่อ expiresAt < now)
 *
 * เก็บใน DB เป็น VARCHAR(20) แต่ validate ผ่าน enum นี้ทั้งหมด
 */
export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
}

export const USER_STATUS_VALUES: ReadonlyArray<string> = Object.values(UserStatus);

/**
 * Status ที่ถือว่าใช้งานระบบได้ — ใช้ใน auth/guard เช็คก่อนปล่อยผ่าน
 */
export const ACTIVE_USER_STATUSES: ReadonlyArray<UserStatus> = [UserStatus.ACTIVE];

/**
 * Helper: เช็คว่า user สามารถ login / ใช้งาน API ได้หรือไม่
 * คำนึงทั้ง status และ expiresAt
 */
export function isUserUsable(user: {
  status?: string | null;
  expiresAt?: Date | null;
}): boolean {
  if (!user) return false;
  if (user.status !== UserStatus.ACTIVE) return false;
  if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) return false;
  return true;
}
