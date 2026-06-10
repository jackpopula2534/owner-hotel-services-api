import { Test, TestingModule } from '@nestjs/testing';
import { HrAttendanceService } from './hr-attendance.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    employee: { findFirst: jest.fn() },
    hrAttendance: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    hrShiftAssignment: { findUnique: jest.fn().mockResolvedValue(null) },
    hrWorkCalendar: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

describe('HrAttendanceService (shift-aware, P1-04)', () => {
  let service: HrAttendanceService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrAttendanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrAttendanceService);
  });

  describe('checkIn', () => {
    beforeEach(() => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.hrAttendance.findUnique.mockResolvedValue(null);
      prisma.hrAttendance.create.mockImplementation(({ data }: any) => ({ id: 'a1', ...data }));
    });

    it('marks late when check-in is past the rostered start + grace', async () => {
      prisma.hrShiftAssignment.findUnique.mockResolvedValue({
        startTime: '08:00',
        isDayOff: false,
        shiftType: null,
      });
      await service.checkIn({ employeeId: 'e1', checkIn: '2026-06-09T08:30:00.000Z' }, 't1');
      expect(prisma.hrAttendance.create.mock.calls[0][0].data.status).toBe('late');
    });

    it('marks present within the grace window', async () => {
      prisma.hrShiftAssignment.findUnique.mockResolvedValue({
        startTime: '08:00',
        isDayOff: false,
        shiftType: null,
      });
      await service.checkIn({ employeeId: 'e1', checkIn: '2026-06-09T08:10:00.000Z' }, 't1');
      expect(prisma.hrAttendance.create.mock.calls[0][0].data.status).toBe('present');
    });

    it('treats a day-off check-in as present (not late)', async () => {
      prisma.hrShiftAssignment.findUnique.mockResolvedValue({ isDayOff: true, shiftType: null });
      await service.checkIn({ employeeId: 'e1', checkIn: '2026-06-09T23:00:00.000Z' }, 't1');
      expect(prisma.hrAttendance.create.mock.calls[0][0].data.status).toBe('present');
    });
  });

  describe('checkOut', () => {
    it('splits work/OT against the rostered shift length', async () => {
      prisma.hrAttendance.findFirst.mockResolvedValue({
        id: 'a1',
        employeeId: 'e1',
        date: new Date('2026-06-09'),
        checkIn: new Date('2026-06-09T08:00:00.000Z'),
        checkOut: null,
        employee: { propertyId: null },
      });
      prisma.hrShiftAssignment.findUnique.mockResolvedValue({
        startTime: '08:00',
        endTime: '17:00',
        isDayOff: false,
        shiftType: { startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
      });
      prisma.hrAttendance.update.mockImplementation(({ data }: any) => ({ id: 'a1', ...data }));

      await service.checkOut('a1', { checkOut: '2026-06-09T18:00:00.000Z' }, 't1');

      const data = prisma.hrAttendance.update.mock.calls[0][0].data;
      // 10h gross, planned 8h (9h span − 1h break) → 480 work + 120 OT
      expect(data.workMinutes).toBe(480);
      expect(data.overtimeMinutes).toBe(120);
    });

    it('counts all minutes as OT on a holiday', async () => {
      prisma.hrAttendance.findFirst.mockResolvedValue({
        id: 'a1',
        employeeId: 'e1',
        date: new Date('2026-06-09'),
        checkIn: new Date('2026-06-09T08:00:00.000Z'),
        checkOut: null,
        employee: { propertyId: null },
      });
      prisma.hrShiftAssignment.findUnique.mockResolvedValue(null);
      prisma.hrWorkCalendar.findFirst.mockResolvedValue({ id: 'h1', isWorkingDay: false });
      prisma.hrAttendance.update.mockImplementation(({ data }: any) => ({ id: 'a1', ...data }));

      await service.checkOut('a1', { checkOut: '2026-06-09T12:00:00.000Z' }, 't1');

      const data = prisma.hrAttendance.update.mock.calls[0][0].data;
      expect(data.workMinutes).toBe(0);
      expect(data.overtimeMinutes).toBe(240);
    });
  });
});
