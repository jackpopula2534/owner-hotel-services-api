import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { HrShiftService } from './hr-shift.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn() },
    hrShiftAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    hrWorkCalendar: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('HrShiftService', () => {
  let service: HrShiftService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrShiftService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrShiftService);
  });

  describe('assign', () => {
    it('throws when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.assign({ employeeId: 'x', date: '2026-06-10', shiftTypeId: 's1' }, 't1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a working shift without shiftType or explicit times', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      await expect(
        service.assign({ employeeId: 'e1', date: '2026-06-10' }, 't1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upserts a day-off without requiring a shift type', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1', propertyId: 'p1', departmentId: 'd1' });
      prisma.hrShiftAssignment.upsert.mockResolvedValue({ id: 'sa1' });
      const res = await service.assign(
        { employeeId: 'e1', date: '2026-06-10', isDayOff: true },
        't1',
        'u1',
      );
      expect(res).toEqual({ id: 'sa1' });
      const arg = prisma.hrShiftAssignment.upsert.mock.calls[0][0];
      expect(arg.where.employeeId_date.employeeId).toBe('e1');
      expect(arg.create.isDayOff).toBe(true);
      expect(arg.create.createdBy).toBe('u1');
    });
  });

  describe('bulkAssign', () => {
    it('collects per-row errors without failing the batch', async () => {
      prisma.employee.findFirst
        .mockResolvedValueOnce({ id: 'e1' })
        .mockResolvedValueOnce(null);
      prisma.hrShiftAssignment.upsert.mockResolvedValue({ id: 'sa1' });
      const res = await service.bulkAssign(
        {
          assignments: [
            { employeeId: 'e1', date: '2026-06-10', shiftTypeId: 's1' },
            { employeeId: 'nope', date: '2026-06-10', shiftTypeId: 's1' },
          ],
        },
        't1',
      );
      expect(res.upserted).toBe(1);
      expect(res.errors).toHaveLength(1);
    });
  });

  describe('work calendar', () => {
    it('creates an entry with formatted multiplier', async () => {
      prisma.hrWorkCalendar.create.mockResolvedValue({ id: 'c1' });
      await service.createCalendarEntry(
        { date: '2026-12-05', name: 'วันพ่อ', payMultiplier: 2 },
        't1',
      );
      const arg = prisma.hrWorkCalendar.create.mock.calls[0][0];
      expect(arg.data.payMultiplier).toBe('2.00');
      expect(arg.data.type).toBe('holiday');
    });

    it('throws updating a missing entry', async () => {
      prisma.hrWorkCalendar.findFirst.mockResolvedValue(null);
      await expect(service.updateCalendarEntry('c1', {}, 't1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
