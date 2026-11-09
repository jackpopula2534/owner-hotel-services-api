import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HrLeaveService } from './hr-leave.service';
import { HrLeavePolicyService } from './hr-leave-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn() },
    hrLeaveType: { findFirst: jest.fn() },
    hrLeaveRequest: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
}

describe('HrLeaveService multi-step approval (P2-05)', () => {
  let service: HrLeaveService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let policy: { resolveEffective: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    policy = { resolveEffective: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrLeaveService,
        { provide: PrismaService, useValue: prisma },
        { provide: HrLeavePolicyService, useValue: policy },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(HrLeaveService);
  });

  it('builds a 2-level approval chain (manager → hr) from policy', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', startDate: '2024-01-01' });
    prisma.hrLeaveType.findFirst.mockResolvedValue({ id: 'lt1', requiresDoc: false });
    policy.resolveEffective.mockResolvedValue({
      approvalLevels: 2, requiresAttachment: false, blackoutDates: [], entitlementDays: 6, id: 'p1',
    });
    prisma.hrLeaveRequest.create.mockImplementation(({ data }: any) => ({ id: 'lr1', ...data }));

    await service.create(
      { employeeId: 'e1', leaveTypeId: 'lt1', startDate: '2026-07-01', endDate: '2026-07-03', totalDays: 3 },
      't1',
    );
    const data = prisma.hrLeaveRequest.create.mock.calls[0][0].data;
    expect(data.requiredLevels).toBe(2);
    expect(data.approvalChain.map((s: any) => s.role)).toEqual(['manager', 'hr']);
  });

  it('rejects when attachment is required but missing', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', startDate: '2024-01-01' });
    prisma.hrLeaveType.findFirst.mockResolvedValue({ id: 'lt1', requiresDoc: false });
    policy.resolveEffective.mockResolvedValue({
      approvalLevels: 1, requiresAttachment: true, blackoutDates: [], entitlementDays: 6, id: 'p1',
    });
    await expect(
      service.create(
        { employeeId: 'e1', leaveTypeId: 'lt1', startDate: '2026-07-01', endDate: '2026-07-03', totalDays: 3 },
        't1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves step by step, finalising on the last level', async () => {
    const base = {
      id: 'lr1', status: 'pending', requiredLevels: 2,
      approvalChain: [
        { level: 1, role: 'manager', status: 'pending', approverId: null, at: null },
        { level: 2, role: 'hr', status: 'pending', approverId: null, at: null },
      ],
      employee: {}, leaveType: {},
    };
    // first step
    prisma.hrLeaveRequest.findFirst.mockResolvedValueOnce(base);
    prisma.hrLeaveRequest.update.mockImplementationOnce(({ data }: any) => ({ id: 'lr1', ...data }));
    const afterFirst = await service.approveStep('lr1', 'mgr', 't1');
    expect(afterFirst.status).not.toBe('approved');
    expect(afterFirst.approvalChain[0].status).toBe('approved');

    // second (final) step
    const midState = {
      ...base,
      approvalChain: [
        { level: 1, role: 'manager', status: 'approved', approverId: 'mgr', at: 'x' },
        { level: 2, role: 'hr', status: 'pending', approverId: null, at: null },
      ],
    };
    prisma.hrLeaveRequest.findFirst.mockResolvedValueOnce(midState);
    prisma.hrLeaveRequest.update.mockImplementationOnce(({ data }: any) => ({ id: 'lr1', ...data }));
    const afterSecond = await service.approveStep('lr1', 'hr1', 't1');
    expect(afterSecond.status).toBe('approved');
    expect(afterSecond.approvedBy).toBe('hr1');
  });
});
