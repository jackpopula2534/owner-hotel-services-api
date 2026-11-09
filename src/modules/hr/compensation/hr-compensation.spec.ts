import { BadRequestException } from '@nestjs/common';
import { HrCompensationService } from './hr-compensation.service';
import {
  nextPayrollCycleStart,
  recordCompensationChange,
  resolveCompensationAsOf,
  todayBusinessDate,
} from './compensation.core';
import { offerCompensation } from './offer-compensation';

function mockDb() {
  const db: any = {
    hrCompensationChange: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => ({ id: 'cc1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'cc1', ...data })),
      updateMany: jest.fn(),
    },
    employee: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'e1', baseSalary: 18000, positionBonus: 0, allowance: 0 }),
      update: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

describe('compensation.core', () => {
  it('nextPayrollCycleStart → first day of next month (Bangkok time)', () => {
    // 31 ต.ค. 2026 20:00 UTC = 1 พ.ย. 03:00 เวลาไทย → รอบถัดไปคือ 1 ธ.ค.
    expect(nextPayrollCycleStart(new Date('2026-10-31T20:00:00Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(nextPayrollCycleStart(new Date('2026-12-15T05:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('resolveCompensationAsOf: history row wins, otherwise falls back to employee', async () => {
    const db = mockDb();
    db.hrCompensationChange.findFirst.mockResolvedValueOnce({
      id: 'x',
      baseSalary: '20000.00',
      positionBonus: '1000.00',
      allowance: null,
    });
    await expect(resolveCompensationAsOf(db, 't1', 'e1', new Date())).resolves.toEqual({
      baseSalary: 20000,
      positionBonus: 1000,
      allowance: 0,
      changeId: 'x',
    });
    await expect(
      resolveCompensationAsOf(db, 't1', 'e1', new Date(), { baseSalary: 15000 }),
    ).resolves.toMatchObject({ baseSalary: 15000, changeId: null });
  });

  it('recordCompensationChange: status follows the effective date', async () => {
    const db = mockDb();
    const now = new Date('2026-11-03T03:00:00Z');
    const base = {
      tenantId: 't1',
      employeeId: 'e1',
      compensation: { baseSalary: 20000, positionBonus: 0, allowance: 0 },
      changeType: 'MANUAL_ADJUST' as const,
      source: 'user' as const,
      actorUserId: 'u1',
      reason: 'ปรับประจำปี',
      now,
    };

    await recordCompensationChange(db, { ...base, effectiveDate: null });
    expect(db.hrCompensationChange.create.mock.calls[0][0].data.status).toBe('pending');

    await recordCompensationChange(db, { ...base, effectiveDate: new Date('2026-12-01') });
    expect(db.hrCompensationChange.create.mock.calls[1][0].data.status).toBe('scheduled');
    expect(db.employee.update).not.toHaveBeenCalled();

    db.hrCompensationChange.findFirst.mockResolvedValue({
      id: 'cc3',
      baseSalary: 20000,
      positionBonus: 0,
      allowance: 0,
    });
    await recordCompensationChange(db, { ...base, effectiveDate: todayBusinessDate(now) });
    const applied = db.hrCompensationChange.create.mock.calls[2][0].data;
    expect(applied.status).toBe('applied');
    expect(applied.appliedAt).toBe(now);
    // ค่าปัจจุบันบน Employee ถูกอัปเดตตามประวัติ
    expect(db.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { baseSalary: 20000, positionBonus: 0, allowance: 0 },
    });
  });

  it('offerCompensation: post-probation falls back to probation terms', () => {
    expect(
      offerCompensation({
        offeredSalary: 18000,
        probationAllowance: 500,
        postProbationSalary: 20000,
      }),
    ).toEqual({
      probation: { baseSalary: 18000, positionBonus: 0, allowance: 500 },
      post: { baseSalary: 20000, positionBonus: 0, allowance: 500 },
    });
  });
});

describe('HrCompensationService', () => {
  let db: ReturnType<typeof mockDb>;
  let audit: { log: jest.Mock };
  let service: HrCompensationService;

  beforeEach(() => {
    db = mockDb();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new HrCompensationService(db, audit as any);
  });

  it('adjust → records a user change with actor + reason and writes an audit log', async () => {
    const row = await service.adjust(
      {
        employeeId: 'e1',
        effectiveDate: '2099-01-01',
        baseSalary: 25000,
        positionBonus: 2000,
        reason: 'เลื่อนตำแหน่ง',
        changeType: 'PROMOTION',
      },
      't1',
      'u1',
    );
    expect(row).toMatchObject({
      changeType: 'PROMOTION',
      source: 'user',
      actorUserId: 'u1',
      status: 'scheduled',
      baseSalary: 25000,
      positionBonus: 2000,
      allowance: 0,
      reason: 'เลื่อนตำแหน่ง',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'e1', userId: 'u1' }),
    );
  });

  it('cancel → only pending/scheduled rows', async () => {
    db.hrCompensationChange.findFirst.mockResolvedValueOnce({ id: 'c1', status: 'applied' });
    await expect(service.cancel('c1', { reason: 'ผิด' }, 't1', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    db.hrCompensationChange.findFirst.mockResolvedValueOnce({
      id: 'c2',
      status: 'scheduled',
      employeeId: 'e1',
      changeType: 'MANUAL_ADJUST',
    });
    await service.cancel('c2', { reason: 'กรอกผิด' }, 't1', 'u1');
    expect(db.hrCompensationChange.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled', cancelledBy: 'u1' }),
      }),
    );
  });

  it('applyDue → marks due rows applied and syncs the employee', async () => {
    db.hrCompensationChange.findMany.mockResolvedValue([
      { id: 'c1', tenantId: 't1', employeeId: 'e1' },
    ]);
    db.hrCompensationChange.findFirst.mockResolvedValue({
      id: 'c1',
      baseSalary: 21000,
      positionBonus: 0,
      allowance: 0,
    });
    await expect(service.applyDue(new Date('2026-12-01T00:10:00+07:00'))).resolves.toBe(1);
    expect(db.hrCompensationChange.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ status: 'applied' }),
      }),
    );
    expect(db.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ baseSalary: 21000 }) }),
    );
  });

  it('listForEmployee hides amounts from roles without pay access', async () => {
    db.hrCompensationChange.findMany.mockResolvedValue([
      {
        id: 'c1',
        effectiveDate: new Date('2026-07-01'),
        changeType: 'HIRE',
        source: 'system',
        status: 'applied',
        baseSalary: 18000,
        positionBonus: 0,
        allowance: 0,
        previous: null,
        actorUserId: 'u1',
        createdAt: new Date(),
      },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'แอน', lastName: 'HR', email: 'a@x.com' },
    ]);

    const forManager = await service.listForEmployee('t1', 'e1', 'manager');
    expect(forManager.canSeePay).toBe(false);
    expect(forManager.current).toBeNull();
    expect(forManager.changes[0].compensation).toBeNull();
    expect(forManager.changes[0].actor).toEqual({ id: 'u1', name: 'แอน HR' });

    const forHr = await service.listForEmployee('t1', 'e1', 'hr');
    expect(forHr.changes[0].compensation).toEqual({
      baseSalary: 18000,
      positionBonus: 0,
      allowance: 0,
      total: 18000,
    });
    expect(forHr.changes[0].effectiveDate).toBe('2026-07-01');
  });
});
