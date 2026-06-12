import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HrProbationService } from './hr-probation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';

function createMockPrisma() {
  const tx = {
    employee: { update: jest.fn() },
    hrProbationRound: { create: jest.fn().mockResolvedValue({ id: 'round-new' }), update: jest.fn() },
    hrProbationCheckpoint: { create: jest.fn(), updateMany: jest.fn() },
    hrHireRecord: { findUnique: jest.fn() },
    hrManpowerRequest: { update: jest.fn() },
  };
  return {
    tx,
    employee: { findFirst: jest.fn() },
    hrProbationRound: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    hrProbationCheckpoint: { update: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
}

describe('HrProbationService (rounds redesign)', () => {
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

  describe('create (manual round)', () => {
    it('opens a round with 30/60/90 checkpoints + final, sets employee PROBATION', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.hrProbationRound.findFirst
        .mockResolvedValueOnce(null) // no active round guard
        .mockResolvedValue({ id: 'round-new', checkpoints: [], employee: {} }); // findOne after create
      prisma.tx.hrProbationRound.create.mockResolvedValue({ id: 'round-new' });

      await service.create(
        { employeeId: 'e1', startDate: '2026-06-01', dueDate: '2026-09-29' }, // 120 days
        't1',
        'u1',
      );
      // 30/60/90 + final(120)
      expect(prisma.tx.hrProbationCheckpoint.create).toHaveBeenCalledTimes(4);
      expect(prisma.tx.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'PROBATION' },
      });
    });

    it('rejects when employee already has an active round', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.hrProbationRound.findFirst.mockResolvedValue({ id: 'round-active' });
      await expect(
        service.create({ employeeId: 'e1', startDate: '2026-06-01', dueDate: '2026-09-01' }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects dueDate before startDate', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.hrProbationRound.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ employeeId: 'e1', startDate: '2026-09-01', dueDate: '2026-06-01' }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reviewCheckpoint', () => {
    it('records a checkpoint review', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue({
        id: 'r1',
        status: 'active',
        checkpoints: [{ id: 'cp1', label: '30 วัน', status: 'pending' }],
      });
      prisma.hrProbationCheckpoint.update.mockResolvedValue({ id: 'cp1', status: 'done' });
      await service.reviewCheckpoint('r1', 'cp1', { score: 85 }, 'reviewer1', 't1');
      expect(prisma.hrProbationCheckpoint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cp1' },
          data: expect.objectContaining({ status: 'done', score: '85.00', reviewerId: 'reviewer1' }),
        }),
      );
    });

    it('rejects reviewing an already-done checkpoint', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue({
        id: 'r1',
        status: 'active',
        checkpoints: [{ id: 'cp1', status: 'done' }],
      });
      await expect(service.reviewCheckpoint('r1', 'cp1', {}, 'rev1', 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('decide', () => {
    const activeRound = {
      id: 'r1',
      status: 'active',
      employeeId: 'e1',
      hireRecordId: null,
      checkpoints: [],
    };

    it('passed → employee ACTIVE + pending checkpoints skipped', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue(activeRound);
      prisma.tx.hrProbationRound.update.mockResolvedValue({ id: 'r1', status: 'passed' });
      await service.decide('r1', { decision: 'passed' }, 'boss1', 't1');
      expect(prisma.tx.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'ACTIVE' },
      });
      expect(prisma.tx.hrProbationCheckpoint.updateMany).toHaveBeenCalledWith({
        where: { roundId: 'r1', status: 'pending' },
        data: { status: 'skipped' },
      });
    });

    it('extended → opens a follow-up round linked via extendedFrom', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue(activeRound);
      prisma.tx.hrProbationRound.update.mockResolvedValue({ id: 'r1', status: 'extended' });
      const result = await service.decide(
        'r1',
        { decision: 'extended', newDueDate: '2026-12-01' },
        'boss1',
        't1',
      );
      expect(prisma.tx.hrProbationRound.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ extendedFrom: 'r1', status: 'active' }) }),
      );
      expect(result.nextRound).not.toBeNull();
    });

    it('extended without newDueDate → 400', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue(activeRound);
      await expect(service.decide('r1', { decision: 'extended' }, 'boss1', 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('failed → employee TERMINATED', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue(activeRound);
      prisma.tx.hrProbationRound.update.mockResolvedValue({ id: 'r1', status: 'failed' });
      await service.decide('r1', { decision: 'failed' }, 'boss1', 't1');
      expect(prisma.tx.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'TERMINATED' },
      });
    });

    it('passed on a pipeline round → closes the manpower request', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue({ ...activeRound, hireRecordId: 'h1' });
      prisma.tx.hrProbationRound.update.mockResolvedValue({ id: 'r1', status: 'passed' });
      prisma.tx.hrHireRecord.findUnique.mockResolvedValue({
        id: 'h1',
        candidate: { manpowerRequestId: 'mpr1' },
      });
      await service.decide('r1', { decision: 'passed' }, 'boss1', 't1');
      expect(prisma.tx.hrManpowerRequest.update).toHaveBeenCalledWith({
        where: { id: 'mpr1' },
        data: { status: 'completed' },
      });
    });

    it('rejects deciding an already-decided round', async () => {
      prisma.hrProbationRound.findFirst.mockResolvedValue({ ...activeRound, status: 'passed' });
      await expect(service.decide('r1', { decision: 'failed' }, 'boss1', 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
