import { BadRequestException } from '@nestjs/common';
import { HrPayrollService } from './hr-payroll.service';

/**
 * จ่ายเงินเดือนต้องเข้าสมุดรายวัน — เดิม markPaid แค่เปลี่ยนสถานะ งบกำไรขาดทุนจึงไม่มีค่าแรงเลย
 */
describe('HrPayrollService.markPaid — journal posting', () => {
  const TENANT = 'tenant-1';
  const codes = ['6301', '1102', '2104', '2102'];
  let prisma: any;
  let journal: { createAndPostAutoEntry: jest.Mock };
  let service: HrPayrollService;

  const payroll = {
    id: 'pay-1',
    employeeId: 'emp-1',
    month: 10,
    year: 2026,
    status: 'approved',
    netSalary: 41750,
    items: [
      { type: 'deduction', name: 'ประกันสังคม', amount: 750 },
      { type: 'deduction', name: 'ภาษีหัก ณ ที่จ่าย', amount: 2000 },
      { type: 'deduction', name: 'หักมาสาย 30 นาที', amount: 500 },
    ],
  };

  beforeEach(() => {
    prisma = {
      hrPayroll: {
        findFirst: jest.fn().mockResolvedValue(payroll),
        update: jest.fn().mockResolvedValue({ ...payroll, status: 'paid' }),
      },
      employee: {
        findFirst: jest.fn().mockResolvedValue({
          propertyId: 'prop-1',
          employeeCode: 'E001',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
        }),
      },
      property: { findFirst: jest.fn() },
      fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) },
      accountChart: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue(codes.map((code) => ({ id: `acc-${code}`, code }))),
      },
    };
    journal = { createAndPostAutoEntry: jest.fn().mockResolvedValue({}) };
    const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
    service = new HrPayrollService(prisma, {} as any, auditLog as any, journal as any);
  });

  it('DR ค่าจ้าง (หลังหักสาย) / CR ธนาคาร + ภาษีหัก ณ ที่จ่าย + ประกันสังคมค้างจ่าย', async () => {
    await service.markPaid('pay-1', TENANT, 'user-1');

    const input = journal.createAndPostAutoEntry.mock.calls[0][1];
    expect(input).toMatchObject({ propertyId: 'prop-1', sourceType: 'PAYROLL', sourceId: 'pay-1' });
    const byAccount = Object.fromEntries(
      input.lines.map((l: any) => [l.accountId, [l.debit, l.credit]]),
    );
    expect(byAccount).toEqual({
      'acc-6301': [44500, 0],
      'acc-1102': [0, 41750],
      'acc-2104': [0, 2000],
      'acc-2102': [0, 750],
    });
  });

  it('งวดบัญชีปิด → จ่ายไม่ผ่าน และสถานะยังเป็น approved', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValue({ year: 2026, status: 'LOCKED' });

    await expect(service.markPaid('pay-1', TENANT, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.hrPayroll.update).not.toHaveBeenCalled();
  });
});
