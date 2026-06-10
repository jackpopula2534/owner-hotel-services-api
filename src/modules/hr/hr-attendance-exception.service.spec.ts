import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrAttendanceExceptionService } from './hr-attendance-exception.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn() },
    hrAttendanceException: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    hrAttendance: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
}

describe('HrAttendanceExceptionService', () => {
  let service: HrAttendanceExceptionService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrAttendanceExceptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(HrAttendanceExceptionService);
  });

  it('creates an exception and writes an audit log', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrAttendanceException.create.mockResolvedValue({ id: 'ex1' });
    const res = await service.create(
      { employeeId: 'e1', date: '2026-06-09', type: 'missed_check_in', reason: 'ลืม' },
      't1',
      'u1',
    );
    expect(res).toEqual({ id: 'ex1' });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('rejects review of an already-reviewed exception', async () => {
    prisma.hrAttendanceException.findFirst.mockResolvedValue({ id: 'ex1', status: 'approved' });
    await expect(
      service.review('ex1', { status: 'approved' }, 'r1', 't1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies correction to an existing attendance on approval', async () => {
    const exception = {
      id: 'ex1',
      status: 'pending',
      employeeId: 'e1',
      attendanceId: 'a1',
      date: new Date('2026-06-09'),
      reason: 'fix',
      requestedCheckIn: new Date('2026-06-09T01:00:00Z'),
      requestedCheckOut: new Date('2026-06-09T10:00:00Z'),
    };
    prisma.hrAttendanceException.findFirst.mockResolvedValue(exception);
    prisma.hrAttendanceException.update.mockResolvedValue({ ...exception, status: 'approved' });
    prisma.hrAttendance.findFirst.mockResolvedValue({ id: 'a1', workMinutes: null });
    prisma.hrAttendance.update.mockResolvedValue({ id: 'a1' });

    await service.review('ex1', { status: 'approved' }, 'r1', 't1');

    const updateArg = prisma.hrAttendance.update.mock.calls[0][0];
    // 9h gross → 8h work + 1h OT
    expect(updateArg.data.workMinutes).toBe(480);
    expect(updateArg.data.overtimeMinutes).toBe(60);
    expect(updateArg.data.status).toBe('present');
  });

  it('does not touch attendance when rejected', async () => {
    prisma.hrAttendanceException.findFirst.mockResolvedValue({
      id: 'ex1',
      status: 'pending',
      employeeId: 'e1',
      date: new Date('2026-06-09'),
      reason: 'x',
    });
    prisma.hrAttendanceException.update.mockResolvedValue({ id: 'ex1', status: 'rejected' });
    await service.review('ex1', { status: 'rejected' }, 'r1', 't1');
    expect(prisma.hrAttendance.update).not.toHaveBeenCalled();
    expect(prisma.hrAttendance.create).not.toHaveBeenCalled();
  });
});
