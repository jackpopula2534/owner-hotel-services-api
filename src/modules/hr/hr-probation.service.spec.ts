import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HrProbationService } from './hr-probation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn(), update: jest.fn() },
    hrProbationReview: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('HrProbationService', () => {
  let service: HrProbationService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrProbationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(HrProbationService);
  });

  it('sets employee to PROBATION on create', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.hrProbationReview.create.mockResolvedValue({ id: 'pr1' });
    await service.create({ employeeId: 'e1', startDate: '2026-06-01', dueDate: '2026-09-01' }, 't1');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'PROBATION' },
    });
  });

  it('passes probation → employee ACTIVE', async () => {
    prisma.hrProbationReview.findFirst.mockResolvedValue({ id: 'pr1', decision: 'pending', employeeId: 'e1' });
    prisma.hrProbationReview.update.mockResolvedValue({ id: 'pr1', decision: 'passed' });
    await service.decide('pr1', { decision: 'passed', score: 88 }, 'r1', 't1');
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'ACTIVE' },
    });
  });

  it('extends probation → re-opens a pending review', async () => {
    prisma.hrProbationReview.findFirst.mockResolvedValue({ id: 'pr1', decision: 'pending', employeeId: 'e1' });
    prisma.hrProbationReview.update.mockResolvedValue({ id: 'pr1', decision: 'extended' });
    await service.decide('pr1', { decision: 'extended', newDueDate: '2026-12-01' }, 'r1', 't1');
    // one create for the new pending cycle
    expect(prisma.hrProbationReview.create).toHaveBeenCalledTimes(1);
    expect(prisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'PROBATION' },
    });
  });

  it('rejects deciding an already-decided review', async () => {
    prisma.hrProbationReview.findFirst.mockResolvedValue({ id: 'pr1', decision: 'passed', employeeId: 'e1' });
    await expect(service.decide('pr1', { decision: 'failed' }, 'r1', 't1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
