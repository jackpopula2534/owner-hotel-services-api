/**
 * payroll-mask.util.ts — RBAC Payroll Field Masking (S2-05)
 *
 * ซ่อน sensitive payroll/financial fields จาก roles ที่ไม่มีสิทธิ์
 *
 * PDPA + RBAC Policy:
 *   - bankAccount, taxId, socialSecurity, baseSalary, initialSalary,
 *     allowance, overtime, positionBonus, netSalary, nationalId
 *   → เปิดเผยได้เฉพาะ: platform_admin, tenant_admin, admin, hr
 *   → role อื่น (manager, receptionist, etc.) จะเห็น "***MASKED***"
 *
 * Usage:
 *   import { maskEmployeePayroll } from '@/common/utils/payroll-mask.util';
 *   const safe = maskEmployeePayroll(employee, user.role);
 */

/** Roles ที่มีสิทธิ์เห็นข้อมูลการเงินแบบ full */
const PRIVILEGED_ROLES = new Set([
  'platform_admin',
  'tenant_admin',
  'admin',
  'hr',
]);

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
  if (!role || PRIVILEGED_ROLES.has(role)) {
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
  if (!role || PRIVILEGED_ROLES.has(role)) return employees;
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
  if (!role || PRIVILEGED_ROLES.has(role)) return payroll;

  const masked = { ...payroll };
  for (const field of SENSITIVE_PAYROLL_FIELDS) {
    if (field in masked) {
      (masked as Record<string, unknown>)[field] = MASKED;
    }
  }
  // ซ่อน bankAccount ของ employee ที่ embed มาใน payroll record
  if (masked['employee'] && typeof masked['employee'] === 'object') {
    const emp = masked['employee'] as Record<string, unknown>;
    if ('bankAccount' in emp) {
      (masked['employee'] as Record<string, unknown>)['bankAccount'] = MASKED;
    }
  }

  return masked as T;
}

export function maskPayrollList<T extends Record<string, unknown>>(
  payrolls: T[],
  role: string | undefined,
): T[] {
  if (!role || PRIVILEGED_ROLES.has(role)) return payrolls;
  return payrolls.map((p) => maskPayrollRecord(p, role));
}
