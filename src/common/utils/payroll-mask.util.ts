/**
 * payroll-mask.util.ts — RBAC Payroll Field Masking (S2-05)
 *
 * ซ่อน sensitive payroll/financial fields จาก roles ที่ไม่มีสิทธิ์
 *
 * PDPA + RBAC Policy:
 *   - bankAccount, taxId, socialSecurity, baseSalary, initialSalary,
 *     allowance, overtime, positionBonus, netSalary, nationalId
 *   → เปิดเผยได้เฉพาะ: platform_admin, super_admin, tenant_admin, admin, hr
 *   → role อื่น (manager, receptionist, etc.) จะเห็น "***MASKED***"
 *
 * นี่คือ RBAC **ภายใน tenant เดียวกัน** ไม่ใช่ด่านกัน cross-tenant
 * (tenant scoping จัดการชั้นนั้นแล้ว) — `'admin'` จึงอยู่ในลิสต์นี้ได้อย่างถูกต้อง
 * ต่างจาก tenant-context.interceptor ที่ห้ามมี allowlist ชื่อ role เด็ดขาด
 *
 * Usage:
 *   import { maskEmployeePayroll } from '@/common/utils/payroll-mask.util';
 *   const safe = maskEmployeePayroll(employee, user.role);
 */

/**
 * Roles ที่มีสิทธิ์เห็นข้อมูลการเงินแบบ full
 *
 * **ลิสต์นี้ derive จาก ROLE_LEVELS ไม่ได้** และห้ามพยายามทำ:
 * `manager` (80) อยู่เหนือ `hr` (70) ในลำดับชั้น แต่ต้องถูก mask ส่วน `hr` ต้องเห็น
 * ROLE_LEVELS เป็นลำดับของ "อำนาจสั่งการ" ไม่ใช่ "สิทธิ์เห็นข้อมูลเงินเดือน"
 * สองอย่างนี้ไม่ได้เรียงตรงกัน การ mask จึงต้องเป็น allowlist ตามชื่อ role
 *
 * `super_admin` เป็น platform-level เหมือน `platform_admin` (อยู่ใน
 * `ADMIN_ONLY_ROLES` → login ได้ทาง `/auth/admin/login` เท่านั้น → มาจากตาราง
 * `Admin` → `isPlatformAdmin: true` เสมอ) และ addon.guard ก็ bypass ให้คู่กัน
 * เดิมมันหายไปจากลิสต์นี้ที่เดียว ทำให้ role level 100 เห็นน้อยกว่า level 90
 */
const PRIVILEGED_ROLES = new Set(['platform_admin', 'super_admin', 'tenant_admin', 'admin', 'hr']);

/**
 * ไม่มี role = ไม่มีสิทธิ์ (fail closed)
 *
 * เดิมฟังก์ชันเหล่านี้เขียน `if (!role || PRIVILEGED_ROLES.has(role))` คือ
 * **token ที่ไม่มี `role` claim จะเห็นข้อมูลเงินเดือนแบบไม่ mask** ตอนนี้ RolesGuard
 * ยังกันไว้ให้ (คืน false เมื่อ `!user.role`) แต่การพึ่งด่านอื่นทั้งที่ตัวเองเป็น
 * ด่านสุดท้ายก่อน serialize ออกไปหา client เป็นค่า default ที่กลับหัว
 */
const isPrivileged = (role: string | undefined): boolean =>
  role ? PRIVILEGED_ROLES.has(role) : false;

const MASKED = '***MASKED***';

/** Sensitive financial/identity fields ที่ต้องซ่อนจาก non-privileged roles */
const SENSITIVE_EMPLOYEE_FIELDS = [
  'bankAccount',
  'bankName',
  'taxId',
  'socialSecurity',
  'baseSalary',
  'initialSalary',
  'allowance',
  'overtime',
  'positionBonus',
  'nationalId',
  'passportNumber',
  'dateOfBirth',
] as const;

/**
 * Mask sensitive fields ของ Employee object ตาม role
 */
export function maskEmployeePayroll<T extends Record<string, unknown>>(
  employee: T,
  role: string | undefined,
): T {
  if (isPrivileged(role)) {
    // HR / Admin → เห็นข้อมูลได้ทั้งหมด
    return employee;
  }

  const masked = { ...employee };
  for (const field of SENSITIVE_EMPLOYEE_FIELDS) {
    if (field in masked && masked[field] !== null && masked[field] !== undefined) {
      (masked as Record<string, unknown>)[field] = MASKED;
    }
  }

  return masked as T;
}

/**
 * Mask array ของ Employee objects
 */
export function maskEmployeeListPayroll<T extends Record<string, unknown>>(
  employees: T[],
  role: string | undefined,
): T[] {
  if (isPrivileged(role)) return employees;
  return employees.map((emp) => maskEmployeePayroll(emp, role));
}

/**
 * Mask sensitive fields ของ Payroll record ตาม role
 * (netSalary, baseSalary, overtimePay, bonusPay visible to hr+ only)
 */
const SENSITIVE_PAYROLL_FIELDS = [
  'baseSalary',
  'totalAllowance',
  'totalDeduction',
  'overtimePay',
  'bonusPay',
  'netSalary',
] as const;

export function maskPayrollRecord<T extends Record<string, unknown>>(
  payroll: T,
  role: string | undefined,
): T {
  if (isPrivileged(role)) return payroll;

  const masked = { ...payroll };
  for (const field of SENSITIVE_PAYROLL_FIELDS) {
    if (field in masked) {
      (masked as Record<string, unknown>)[field] = MASKED;
    }
  }
  // ซ่อน bankAccount ของ employee ที่ embed มาใน payroll record
  if (masked['employee'] && typeof masked['employee'] === 'object') {
    const emp = { ...(masked['employee'] as Record<string, unknown>) };
    if ('bankAccount' in emp) {
      emp['bankAccount'] = MASKED;
    }
    (masked as Record<string, unknown>)['employee'] = emp;
  }

  // hr_payroll_items คือ breakdown รายบรรทัด (base, allowance, ot, deduction…)
  // ถ้าปล่อยผ่าน manager จะบวก items[].amount กลับมาเป็น netSalary ได้ทั้งที่
  // field netSalary ถูก mask ไปแล้ว — การ mask scalar อย่างเดียวจึงไร้ผล
  if (Array.isArray(masked['items'])) {
    (masked as Record<string, unknown>)['items'] = (
      masked['items'] as Record<string, unknown>[]
    ).map((item) =>
      item && typeof item === 'object' && 'amount' in item ? { ...item, amount: MASKED } : item,
    );
  }

  return masked as T;
}

export function maskPayrollList<T extends Record<string, unknown>>(
  payrolls: T[],
  role: string | undefined,
): T[] {
  if (isPrivileged(role)) return payrolls;
  return payrolls.map((p) => maskPayrollRecord(p, role));
}
