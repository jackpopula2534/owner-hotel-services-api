import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnonymizeService } from '../../../src/common/services/anonymize.service';
import { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * Unit tests — AnonymizeService (PDPA Right to Erasure)
 * S4-02 PDPA Test Coverage — S2-02
 */

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = 'redacted@anonymized.invalid';
const REDACTED_PHONE = '0000000000';

// ─── mock data ───────────────────────────────────────────────
const mockGuest = {
  id: 'guest-1',
  tenantId: 'tenant-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '0812345678',
  nationalId: 'enc:abc123',
  passportNumber: null,
  dateOfBirth: new Date('1985-05-15'),
  nationality: 'Thai',
  address: '123 Main St',
  city: 'Bangkok',
  country: 'TH',
  postalCode: '10100',
  vehiclePlateNumber: null,
  specialNotes: 'VIP',
  vipLevel: 'gold',
  anonymizedAt: null,
  createdAt: new Date('2021-01-01'),
};

const mockEmployee = {
  id: 'emp-1',
  tenantId: 'tenant-1',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  email: 'somchai@hotel.com',
  phone: '0898765432',
  nationalId: 'enc:xyz789',
  bankAccount: 'enc:bank001',
  bankName: 'SCB',
  socialSecurity: 'enc:ss001',
  taxId: 'enc:tax001',
  dateOfBirth: new Date('1990-03-20'),
  address: '456 Soi 10',
  emergencyContacts: [{ name: 'Mom', phone: '0811111111' }],
  educations: [],
  workExperiences: [],
  notes: 'Good worker',
  nickname: 'ชาย',
  status: 'ACTIVE',
  anonymizedAt: null,
  updatedAt: new Date('2024-01-01'),
};

// ─── mock prisma ─────────────────────────────────────────────
function buildMockPrisma() {
  return {
    guest: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    employee: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('AnonymizeService', () => {
  let service: AnonymizeService;
  let prisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(async () => {
    prisma = buildMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnonymizeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AnonymizeService>(AnonymizeService);
  });

  afterEach(() => jest.clearAllMocks());

  // ────────────────────────────────────────────────────────────
  // anonymizeGuest()
  // ────────────────────────────────────────────────────────────
  describe('anonymizeGuest()', () => {
    it('should anonymize all PII fields of the guest', async () => {
      prisma.guest.findFirst.mockResolvedValue(mockGuest);
      prisma.guest.update.mockResolvedValue({});

      await service.anonymizeGuest('guest-1', 'tenant-1');

      expect(prisma.guest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'guest-1' },
          data: expect.objectContaining({
            firstName: REDACTED,
            lastName: REDACTED,
            email: REDACTED_EMAIL,
            phone: REDACTED_PHONE,
            nationalId: null,
            passportNumber: null,
            dateOfBirth: null,
            nationality: null,
            address: null,
            city: null,
            country: null,
            postalCode: null,
            vehiclePlateNumber: null,
            specialNotes: null,
            vipLevel: null,
          }),
        }),
      );
    });

    it('should set anonymizedAt to current date on update', async () => {
      prisma.guest.findFirst.mockResolvedValue(mockGuest);
      prisma.guest.update.mockResolvedValue({});

      const before = new Date();
      await service.anonymizeGuest('guest-1', 'tenant-1');
      const after = new Date();

      const updateCall = prisma.guest.update.mock.calls[0][0];
      const anonymizedAt: Date = updateCall.data.anonymizedAt;
      expect(anonymizedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(anonymizedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should throw NotFoundException when guest not found', async () => {
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(service.anonymizeGuest('no-such-guest', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.guest.update).not.toHaveBeenCalled();
    });

    it('should skip (not throw) if guest already anonymized', async () => {
      const alreadyAnon = { ...mockGuest, anonymizedAt: new Date('2023-01-01') };
      prisma.guest.findFirst.mockResolvedValue(alreadyAnon);

      await service.anonymizeGuest('guest-1', 'tenant-1');

      expect(prisma.guest.update).not.toHaveBeenCalled();
    });

    it('should query by both guestId and tenantId (tenant isolation)', async () => {
      prisma.guest.findFirst.mockResolvedValue(null);

      await expect(service.anonymizeGuest('guest-1', 'tenant-99')).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.guest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'guest-1', tenantId: 'tenant-99' },
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // anonymizeEmployee()
  // ────────────────────────────────────────────────────────────
  describe('anonymizeEmployee()', () => {
    it('should anonymize all PII fields of the employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.employee.update.mockResolvedValue({});

      await service.anonymizeEmployee('emp-1', 'tenant-1');

      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: expect.objectContaining({
            firstName: REDACTED,
            lastName: REDACTED,
            email: REDACTED_EMAIL,
            phone: REDACTED_PHONE,
            nationalId: null,
            bankAccount: null,
            bankName: null,
            socialSecurity: null,
            taxId: null,
            dateOfBirth: null,
            address: null,
            emergencyContacts: null,
            educations: null,
            workExperiences: null,
            notes: null,
            nickname: null,
            status: 'ANONYMIZED',
          }),
        }),
      );
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.anonymizeEmployee('no-emp', 'tenant-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should skip if employee already anonymized', async () => {
      const alreadyAnon = { ...mockEmployee, anonymizedAt: new Date() };
      prisma.employee.findFirst.mockResolvedValue(alreadyAnon);

      await service.anonymizeEmployee('emp-1', 'tenant-1');

      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('should set status to ANONYMIZED', async () => {
      prisma.employee.findFirst.mockResolvedValue(mockEmployee);
      prisma.employee.update.mockResolvedValue({});

      await service.anonymizeEmployee('emp-1', 'tenant-1');

      const updateCall = prisma.employee.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('ANONYMIZED');
    });
  });

  // ────────────────────────────────────────────────────────────
  // purgeExpiredGuests()
  // ────────────────────────────────────────────────────────────
  describe('purgeExpiredGuests()', () => {
    it('should anonymize all expired guests', async () => {
      const expiredGuests = [
        { id: 'g-1', tenantId: 'tenant-1' },
        { id: 'g-2', tenantId: 'tenant-1' },
      ];
      prisma.guest.findMany.mockResolvedValue(expiredGuests);
      // anonymizeGuest calls findFirst then update
      prisma.guest.findFirst
        .mockResolvedValueOnce({ ...mockGuest, id: 'g-1' })
        .mockResolvedValueOnce({ ...mockGuest, id: 'g-2' });
      prisma.guest.update.mockResolvedValue({});

      const count = await service.purgeExpiredGuests(5);
      expect(count).toBe(2);
      expect(prisma.guest.update).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no expired guests found', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      const count = await service.purgeExpiredGuests(5);
      expect(count).toBe(0);
      expect(prisma.guest.update).not.toHaveBeenCalled();
    });

    it('should use 5-year retention by default', async () => {
      prisma.guest.findMany.mockResolvedValue([]);

      await service.purgeExpiredGuests();

      const findCall = prisma.guest.findMany.mock.calls[0][0];
      const cutoff: Date = findCall.where.createdAt.lt;
      const expectedCutoff = new Date();
      expectedCutoff.setFullYear(expectedCutoff.getFullYear() - 5);

      // cutoff ควรอยู่ใกล้ 5 ปีก่อน (ยืดหยุ่น 5 วินาที)
      expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
    });

    it('should continue purging other guests even if one fails', async () => {
      const expiredGuests = [
        { id: 'g-fail', tenantId: 'tenant-1' },
        { id: 'g-ok', tenantId: 'tenant-1' },
      ];
      prisma.guest.findMany.mockResolvedValue(expiredGuests);
      // g-fail throws, g-ok succeeds
      prisma.guest.findFirst
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ ...mockGuest, id: 'g-ok' });
      prisma.guest.update.mockResolvedValue({});

      // ไม่ throw และ count = 1 (ที่สำเร็จ)
      const count = await service.purgeExpiredGuests(5);
      expect(count).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // purgeExpiredEmployees()
  // ────────────────────────────────────────────────────────────
  describe('purgeExpiredEmployees()', () => {
    it('should anonymize all expired resigned/terminated employees', async () => {
      const expiredEmployees = [
        { id: 'e-1', tenantId: 'tenant-1' },
        { id: 'e-2', tenantId: 'tenant-2' },
      ];
      prisma.employee.findMany.mockResolvedValue(expiredEmployees);
      prisma.employee.findFirst
        .mockResolvedValueOnce({ ...mockEmployee, id: 'e-1' })
        .mockResolvedValueOnce({ ...mockEmployee, id: 'e-2' });
      prisma.employee.update.mockResolvedValue({});

      const count = await service.purgeExpiredEmployees(7);
      expect(count).toBe(2);
    });

    it('should query only RESIGNED and TERMINATED employees', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      await service.purgeExpiredEmployees(7);

      const findCall = prisma.employee.findMany.mock.calls[0][0];
      expect(findCall.where.status).toEqual({ in: ['RESIGNED', 'TERMINATED'] });
    });

    it('should use 7-year retention by default', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      await service.purgeExpiredEmployees();

      const findCall = prisma.employee.findMany.mock.calls[0][0];
      const cutoff: Date = findCall.where.updatedAt.lt;
      const expectedCutoff = new Date();
      expectedCutoff.setFullYear(expectedCutoff.getFullYear() - 7);

      expect(Math.abs(cutoff.getTime() - expectedCutoff.getTime())).toBeLessThan(5000);
    });

    it('should return 0 when no expired employees', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      const count = await service.purgeExpiredEmployees(7);
      expect(count).toBe(0);
    });
  });
});
