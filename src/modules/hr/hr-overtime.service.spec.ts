import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrOvertimeService } from './hr-overtime.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn() },
    hrOvertimeRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
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
