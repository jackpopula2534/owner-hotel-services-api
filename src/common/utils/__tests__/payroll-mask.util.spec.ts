import {
  maskEmployeePayroll,
  maskEmployeeListPayroll,
  maskPayrollRecord,
  maskPayrollList,
} from '../payroll-mask.util';

/**
 * Unit tests — payroll-mask.util (RBAC Payroll Field Masking)
 * S4-02 PDPA Test Coverage — S2-05
 */

const MASKED = '***MASKED***';

const mockEmployee = {
  id: 'emp-1',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  email: 'somchai@hotel.com',
  department: 'Front Desk',
  position: 'Receptionist',
  // sensitive fields
  bankAccount: '1234567890',
  bankName: 'SCB',
  taxId: 'T123456789',
  socialSecurity: '1234567-1-23-4',
  baseSalary: 25000,
  initialSalary: 22000,
  allowance: 2000,
  overtime: 1500,
  positionBonus: 3000,
  nationalId: '1234567890123',
  passportNumber: 'TH9876543',
  dateOfBirth: new Date('1990-01-01'),
};

const mockPayroll = {
  id: 'payroll-1',
  employeeId: 'emp-1',
  month: 5,
  year: 2026,
  baseSalary: 25000,
  totalAllowance: 3500,
  totalDeduction: 1000,
  overtimePay: 1500,
  bonusPay: 5000,
  netSalary: 34000,
  employee: {
    id: 'emp-1',
    firstName: 'สมชาย',
    bankAccount: '1234567890',
  },
};

// ──────────────────────────────────────────────────────────────
// maskEmployeePayroll
// ──────────────────────────────────────────────────────────────
describe('maskEmployeePayroll()', () => {
  const PRIVILEGED_ROLES = ['platform_admin', 'super_admin', 'tenant_admin', 'admin', 'hr'];
  const NON_PRIVILEGED_ROLES = ['manager', 'receptionist', 'staff', 'kitchen'];

  describe('privileged roles — should see full data', () => {
    for (const role of PRIVILEGED_ROLES) {
      it(`role="${role}" should return employee unchanged`, () => {
        const result = maskEmployeePayroll(mockEmployee, role);
        expect(result).toEqual(mockEmployee);
        expect(result.bankAccount).toBe(mockEmployee.bankAccount);
        expect(result.taxId).toBe(mockEmployee.taxId);
        expect(result.nationalId).toBe(mockEmployee.nationalId);
        expect(result.baseSalary).toBe(mockEmployee.baseSalary);
      });
    }
  });

  describe('non-privileged roles — should mask sensitive fields', () => {
    for (const role of NON_PRIVILEGED_ROLES) {
      it(`role="${role}" should mask all sensitive fields`, () => {
        const result = maskEmployeePayroll(mockEmployee, role);

        // sensitive fields ต้องถูก mask
        expect(result.bankAccount).toBe(MASKED);
        expect(result.bankName).toBe(MASKED);
        expect(result.taxId).toBe(MASKED);
        expect(result.socialSecurity).toBe(MASKED);
        expect(result.baseSalary).toBe(MASKED);
        expect(result.initialSalary).toBe(MASKED);
        expect(result.allowance).toBe(MASKED);
        expect(result.overtime).toBe(MASKED);
        expect(result.positionBonus).toBe(MASKED);
        expect(result.nationalId).toBe(MASKED);
        expect(result.passportNumber).toBe(MASKED);
        expect(result.dateOfBirth).toBe(MASKED);

        // non-sensitive fields ต้องไม่เปลี่ยน
        expect(result.id).toBe(mockEmployee.id);
        expect(result.firstName).toBe(mockEmployee.firstName);
        expect(result.lastName).toBe(mockEmployee.lastName);
        expect(result.email).toBe(mockEmployee.email);
        expect(result.department).toBe(mockEmployee.department);
        expect(result.position).toBe(mockEmployee.position);
      });
    }
  });

  it('should mask when role is undefined (fail closed)', () => {
    // A token with no `role` claim proves nothing. Returning the record intact
    // made "no role" the most privileged caller of all.
    const result = maskEmployeePayroll(mockEmployee, undefined);
    expect(result.bankAccount).toBe(MASKED);
    expect(result.nationalId).toBe(MASKED);
    expect(result.baseSalary).toBe(MASKED);
  });

  it('should NOT mutate the original employee object', () => {
    const original = { ...mockEmployee };
    maskEmployeePayroll(mockEmployee, 'manager');
    expect(mockEmployee.bankAccount).toBe(original.bankAccount);
    expect(mockEmployee.nationalId).toBe(original.nationalId);
  });

  describe('privilege is an allowlist, not a rank', () => {
    // ROLE_LEVELS orders command authority, not payroll visibility. Anyone who
    // "simplifies" this util into `getRoleLevel(role) >= getRoleLevel('hr')`
    // hands every manager the salary book. These two cases pin that down.
    it('masks manager (level 80) even though it outranks hr (level 70)', () => {
      expect(maskEmployeePayroll(mockEmployee, 'manager').baseSalary).toBe(MASKED);
    });

    it('gives hr (level 70) full data even though manager outranks it', () => {
      expect(maskEmployeePayroll(mockEmployee, 'hr').baseSalary).toBe(mockEmployee.baseSalary);
    });

    it('gives super_admin (level 100) at least what admin (level 90) sees', () => {
      // super_admin is platform-level: ADMIN_ONLY_ROLES sends it to
      // /auth/admin/login, so it always arrives with isPlatformAdmin: true.
      // It used to be missing here alone, so it saw less than admin.
      expect(maskEmployeePayroll(mockEmployee, 'super_admin')).toEqual(mockEmployee);
    });
  });

  it('should skip masking null/undefined sensitive fields', () => {
    const empWithNulls = {
      id: 'emp-2',
      firstName: 'น้อย',
      bankAccount: null,
      taxId: undefined,
      baseSalary: null,
    };
    const result = maskEmployeePayroll(empWithNulls as any, 'receptionist');
    // null/undefined fields ไม่ควรถูก mask เป็น MASKED string
    expect(result.bankAccount).toBeNull();
    expect(result.taxId).toBeUndefined();
    expect(result.baseSalary).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────
// maskEmployeeListPayroll
// ──────────────────────────────────────────────────────────────
describe('maskEmployeeListPayroll()', () => {
  const employees = [
    { ...mockEmployee, id: 'emp-1' },
    { ...mockEmployee, id: 'emp-2' },
    { ...mockEmployee, id: 'emp-3' },
  ];

  it('should mask all employees in list for non-privileged role', () => {
    const result = maskEmployeeListPayroll(employees, 'receptionist');
    expect(result).toHaveLength(3);
    for (const emp of result) {
      expect(emp.bankAccount).toBe(MASKED);
      expect(emp.nationalId).toBe(MASKED);
    }
  });

  it('should return full data for privileged role', () => {
    const result = maskEmployeeListPayroll(employees, 'hr');
    expect(result).toHaveLength(3);
    for (const emp of result) {
      expect(emp.bankAccount).toBe(mockEmployee.bankAccount);
    }
  });

  it('should return the same reference for privileged role (no copy)', () => {
    const result = maskEmployeeListPayroll(employees, 'admin');
    expect(result).toBe(employees);
  });

  it('should handle empty array', () => {
    expect(maskEmployeeListPayroll([], 'manager')).toEqual([]);
  });

  it('should mask every row when role is undefined (fail closed)', () => {
    const result = maskEmployeeListPayroll(employees, undefined);
    expect(result.every((e) => e.bankAccount === MASKED)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// maskPayrollRecord
// ──────────────────────────────────────────────────────────────
describe('maskPayrollRecord()', () => {
  it('should mask financial fields for non-privileged role', () => {
    const result = maskPayrollRecord(mockPayroll, 'manager');

    expect(result.baseSalary).toBe(MASKED);
    expect(result.totalAllowance).toBe(MASKED);
    expect(result.totalDeduction).toBe(MASKED);
    expect(result.overtimePay).toBe(MASKED);
    expect(result.bonusPay).toBe(MASKED);
    expect(result.netSalary).toBe(MASKED);
  });

  it('should mask embedded employee.bankAccount for non-privileged role', () => {
    const result = maskPayrollRecord(mockPayroll, 'receptionist');
    const emp = result.employee as Record<string, unknown>;
    expect(emp.bankAccount).toBe(MASKED);
  });

  it('should NOT mask non-sensitive payroll fields', () => {
    const result = maskPayrollRecord(mockPayroll, 'manager');
    expect(result.id).toBe(mockPayroll.id);
    expect(result.employeeId).toBe(mockPayroll.employeeId);
    expect(result.month).toBe(mockPayroll.month);
    expect(result.year).toBe(mockPayroll.year);
  });

  it('should return full data for hr role', () => {
    const result = maskPayrollRecord(mockPayroll, 'hr');
    expect(result.baseSalary).toBe(mockPayroll.baseSalary);
    expect(result.netSalary).toBe(mockPayroll.netSalary);
  });

  it('should return full data for tenant_admin role', () => {
    const result = maskPayrollRecord(mockPayroll, 'tenant_admin');
    expect(result).toEqual(mockPayroll);
  });

  it('should return full data for super_admin role', () => {
    const result = maskPayrollRecord(mockPayroll, 'super_admin');
    expect(result).toEqual(mockPayroll);
  });

  it('should NOT mutate original payroll object', () => {
    const original = { ...mockPayroll };
    maskPayrollRecord(mockPayroll, 'manager');
    expect(mockPayroll.baseSalary).toBe(original.baseSalary);
    expect(mockPayroll.netSalary).toBe(original.netSalary);
  });

  it('should NOT mutate the embedded employee object', () => {
    // shallow copy ของ payroll ยังชี้ employee ก้อนเดิม การเขียน MASKED ทับ
    // จึงไปแก้ record ที่ caller ถืออยู่ (และ cache ของ Prisma) ด้วย
    maskPayrollRecord(mockPayroll, 'manager');
    expect(mockPayroll.employee.bankAccount).toBe('1234567890');
  });

  it('should handle payroll without embedded employee', () => {
    const payrollNoEmp = { ...mockPayroll, employee: undefined };
    const result = maskPayrollRecord(payrollNoEmp as any, 'receptionist');
    expect(result.baseSalary).toBe(MASKED);
    // ไม่ crash เมื่อไม่มี employee embed
  });

  describe('hr_payroll_items breakdown', () => {
    // hr-payroll.service includes `items: true` on findAll/findOne. Every line
    // item carries an `amount`, so a manager could sum them back into the
    // netSalary that the scalar masking pretends to hide.
    const payrollWithItems = {
      ...mockPayroll,
      items: [
        { id: 'i1', type: 'base', name: 'เงินเดือน', amount: 25000 },
        { id: 'i2', type: 'ot', name: 'ค่าล่วงเวลา', amount: 1500 },
        { id: 'i3', type: 'deduction', name: 'ประกันสังคม', amount: 750 },
      ],
    };

    it('masks every item amount for a non-privileged role', () => {
      const result = maskPayrollRecord(payrollWithItems, 'manager');

      expect((result.items as any[]).map((i) => i.amount)).toEqual([MASKED, MASKED, MASKED]);
    });

    it('keeps the non-financial item fields readable', () => {
      const result = maskPayrollRecord(payrollWithItems, 'manager');

      expect((result.items as any[])[0]).toMatchObject({ type: 'base', name: 'เงินเดือน' });
    });

    it('leaves item amounts intact for hr', () => {
      const result = maskPayrollRecord(payrollWithItems, 'hr');

      expect((result.items as any[])[0].amount).toBe(25000);
    });

    it('masks item amounts when the role is missing', () => {
      const result = maskPayrollRecord(payrollWithItems, undefined);

      expect((result.items as any[])[1].amount).toBe(MASKED);
    });

    it('does not mutate the original items', () => {
      maskPayrollRecord(payrollWithItems, 'manager');

      expect(payrollWithItems.items[0].amount).toBe(25000);
    });
  });
});

// ──────────────────────────────────────────────────────────────
// maskPayrollList
// ──────────────────────────────────────────────────────────────
describe('maskPayrollList()', () => {
  const payrolls = [
    { ...mockPayroll, id: 'pr-1' },
    { ...mockPayroll, id: 'pr-2' },
  ];

  it('should mask all payrolls for non-privileged role', () => {
    const result = maskPayrollList(payrolls, 'manager');
    for (const p of result) {
      expect(p.netSalary).toBe(MASKED);
      expect(p.baseSalary).toBe(MASKED);
    }
  });

  it('should return unchanged for privileged role', () => {
    const result = maskPayrollList(payrolls, 'admin');
    expect(result).toBe(payrolls);
  });

  it('should handle empty array', () => {
    expect(maskPayrollList([], 'receptionist')).toEqual([]);
  });
});
