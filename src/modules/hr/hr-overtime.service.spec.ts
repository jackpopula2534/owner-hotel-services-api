import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrOvertimeService } from './hr-overtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    hrOvertimeRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
    },
  };
}

describe('HrOvertimeService', () => {
  let service: HrOvertimeService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrOvertimeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(HrOvertimeService);
  });

  it('creates an OT request with default multiplier formatted', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrOvertimeRequest.create.mockResolvedValue({ id: 'ot1' });
    await service.create({ employeeId: 'e1', date: '2026-06-09', minutes: 120 }, 't1', 'u1');
    const arg = prisma.hrOvertimeRequest.create.mock.calls[0][0];
    expect(arg.data.multiplier).toBe('1.50');
    expect(arg.data.minutes).toBe(120);
    expect(audit.log).toHaveBeenCalled();
  });

  it('creates bulk OT only for employees in the tenant', async () => {
    prisma.employee.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
    prisma.hrOvertimeRequest.createMany.mockResolvedValue({ count: 2 });
    const res = await service.createBulk(
      [
        { employeeId: 'e1', date: '2026-06-09', minutes: 120 },
        { employeeId: 'e2', date: '2026-06-09', minutes: 120, multiplier: 2 },
        { employeeId: 'outsider', date: '2026-06-09', minutes: 120 },
      ],
      't1',
      'u1',
    );
    const arg = prisma.hrOvertimeRequest.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0].multiplier).toBe('1.50');
    expect(arg.data[1].multiplier).toBe('2.00');
    expect(res).toEqual({ created: 2, skipped: 1, skippedEmployeeIds: ['outsider'] });
    expect(audit.log).toHaveBeenCalled();
  });

  it('throws when no valid employees in bulk request', async () => {
    prisma.employee.findMany.mockResolvedValue([]);
    await expect(
      service.createBulk([{ employeeId: 'x', date: '2026-06-09', minutes: 60 }], 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when employee missing', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ employeeId: 'x', date: '2026-06-09', minutes: 60 }, 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets approvedBy/approvedAt on approval', async () => {
    prisma.hrOvertimeRequest.findFirst.mockResolvedValue({ id: 'ot1', status: 'pending' });
    prisma.hrOvertimeRequest.update.mockResolvedValue({ id: 'ot1', status: 'approved' });
    await service.review('ot1', { status: 'approved' }, 'r1', 't1');
    const arg = prisma.hrOvertimeRequest.update.mock.calls[0][0];
    expect(arg.data.status).toBe('approved');
    expect(arg.data.approvedBy).toBe('r1');
    expect(arg.data.approvedAt).toBeInstanceOf(Date);
  });

  it('rejects review of non-pending requests', async () => {
    prisma.hrOvertimeRequest.findFirst.mockResolvedValue({ id: 'ot1', status: 'approved' });
    await expect(
      service.review('ot1', { status: 'rejected' }, 'r1', 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
