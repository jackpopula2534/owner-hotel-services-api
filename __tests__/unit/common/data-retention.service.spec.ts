import { Test, TestingModule } from '@nestjs/testing';
import { DataRetentionService } from '../../../src/common/services/data-retention.service';
import { AnonymizeService } from '../../../src/common/services/anonymize.service';

/**
 * Unit tests — DataRetentionService (PDPA Data Retention Cron)
 * S4-02 PDPA Test Coverage — S2-03
 */

function buildMockAnonymizeService() {
  return {
    purgeExpiredGuests: jest.fn().mockResolvedValue(0),
    purgeExpiredEmployees: jest.fn().mockResolvedValue(0),
  };
}

describe('DataRetentionService', () => {
  let service: DataRetentionService;
  let anonymizeService: ReturnType<typeof buildMockAnonymizeService>;

  beforeEach(async () => {
    anonymizeService = buildMockAnonymizeService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRetentionService,
        { provide: AnonymizeService, useValue: anonymizeService },
      ],
    }).compile();

    service = module.get<DataRetentionService>(DataRetentionService);
  });

  afterEach(() => jest.clearAllMocks());

  // ────────────────────────────────────────────────────────────
  // getRetentionPolicy()
  // ────────────────────────────────────────────────────────────
  describe('getRetentionPolicy()', () => {
    it('should return correct default retention years', () => {
      const policy = service.getRetentionPolicy();

      expect(policy.guest.years).toBe(5);
      expect(policy.employee.years).toBe(7);
      expect(policy.booking.years).toBe(5);
      expect(policy.auditLog.years).toBe(3);
    });

    it('should return description for each category', () => {
      const policy = service.getRetentionPolicy();

      expect(policy.guest.description).toBeTruthy();
      expect(policy.employee.description).toBeTruthy();
      expect(policy.booking.description).toBeTruthy();
      expect(policy.auditLog.description).toBeTruthy();
    });

    it('should return object with guest, employee, booking, auditLog keys', () => {
      const policy = service.getRetentionPolicy();
      expect(policy).toHaveProperty('guest');
      expect(policy).toHaveProperty('employee');
      expect(policy).toHaveProperty('booking');
      expect(policy).toHaveProperty('auditLog');
    });
  });

  // ────────────────────────────────────────────────────────────
  // runFullPurgeNow()
  // ────────────────────────────────────────────────────────────
  describe('runFullPurgeNow()', () => {
    it('should call both purgeExpiredGuests and purgeExpiredEmployees', async () => {
      anonymizeService.purgeExpiredGuests.mockResolvedValue(3);
      anonymizeService.purgeExpiredEmployees.mockResolvedValue(1);

      const result = await service.runFullPurgeNow();

      expect(anonymizeService.purgeExpiredGuests).toHaveBeenCalledTimes(1);
      expect(anonymizeService.purgeExpiredEmployees).toHaveBeenCalledTimes(1);
    });

    it('should return correct counts from purge results', async () => {
      anonymizeService.purgeExpiredGuests.mockResolvedValue(10);
      anonymizeService.purgeExpiredEmployees.mockResolvedValue(3);

      const result = await service.runFullPurgeNow();

      expect(result).toEqual({ guestsPurged: 10, employeesPurged: 3 });
    });

    it('should return 0 counts when nothing to purge', async () => {
      anonymizeService.purgeExpiredGuests.mockResolvedValue(0);
      anonymizeService.purgeExpiredEmployees.mockResolvedValue(0);

      const result = await service.runFullPurgeNow();

      expect(result).toEqual({ guestsPurged: 0, employeesPurged: 0 });
    });

    it('should run both purges concurrently (Promise.all)', async () => {
      let guestStarted = false;
      let employeeStarted = false;

      anonymizeService.purgeExpiredGuests.mockImplementation(async () => {
        guestStarted = true;
        await new Promise((r) => setTimeout(r, 10));
        return 5;
      });
      anonymizeService.purgeExpiredEmployees.mockImplementation(async () => {
        employeeStarted = true;
        await new Promise((r) => setTimeout(r, 10));
        return 2;
      });

      const result = await service.runFullPurgeNow();

      expect(guestStarted).toBe(true);
      expect(employeeStarted).toBe(true);
      expect(result.guestsPurged).toBe(5);
      expect(result.employeesPurged).toBe(2);
    });

    it('should pass correct retention years to anonymize service', async () => {
      await service.runFullPurgeNow();

      // default guest retention = 5 years
      expect(anonymizeService.purgeExpiredGuests).toHaveBeenCalledWith(5);
      // default employee retention = 7 years
      expect(anonymizeService.purgeExpiredEmployees).toHaveBeenCalledWith(7);
    });
  });

  // ────────────────────────────────────────────────────────────
  // runGuestPurge() — cron job wrapper
  // ────────────────────────────────────────────────────────────
  describe('runGuestPurge()', () => {
    it('should call purgeExpiredGuests with correct retention years', async () => {
      anonymizeService.purgeExpiredGuests.mockResolvedValue(7);

      await service.runGuestPurge();

      expect(anonymizeService.purgeExpiredGuests).toHaveBeenCalledWith(5);
    });

    it('should NOT throw if purgeExpiredGuests throws (swallows error)', async () => {
      anonymizeService.purgeExpiredGuests.mockRejectedValue(new Error('DB timeout'));

      // ไม่ควร throw ออกมา (cron job swallows error)
      await expect(service.runGuestPurge()).resolves.not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────
  // runEmployeePurge() — cron job wrapper
  // ────────────────────────────────────────────────────────────
  describe('runEmployeePurge()', () => {
    it('should call purgeExpiredEmployees with correct retention years', async () => {
      anonymizeService.purgeExpiredEmployees.mockResolvedValue(2);

      await service.runEmployeePurge();

      expect(anonymizeService.purgeExpiredEmployees).toHaveBeenCalledWith(7);
    });

    it('should NOT throw if purgeExpiredEmployees throws (swallows error)', async () => {
      anonymizeService.purgeExpiredEmployees.mockRejectedValue(new Error('Connection refused'));

      await expect(service.runEmployeePurge()).resolves.not.toThrow();
    });
  });

  // ────────────────────────────────────────────────────────────
  // env var override
  // ────────────────────────────────────────────────────────────
  describe('env var retention override', () => {
    it('should use RETENTION_GUEST_YEARS env var when set', async () => {
      process.env.RETENTION_GUEST_YEARS = '3';
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DataRetentionService,
          { provide: AnonymizeService, useValue: buildMockAnonymizeService() },
        ],
      }).compile();

      const svc = module.get<DataRetentionService>(DataRetentionService);
      const policy = svc.getRetentionPolicy();
      expect(policy.guest.years).toBe(3);

      delete process.env.RETENTION_GUEST_YEARS;
    });

    it('should use RETENTION_EMPLOYEE_YEARS env var when set', async () => {
      process.env.RETENTION_EMPLOYEE_YEARS = '10';
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DataRetentionService,
          { provide: AnonymizeService, useValue: buildMockAnonymizeService() },
        ],
      }).compile();

      const svc = module.get<DataRetentionService>(DataRetentionService);
      const policy = svc.getRetentionPolicy();
      expect(policy.employee.years).toBe(10);

      delete process.env.RETENTION_EMPLOYEE_YEARS;
    });
  });
});
