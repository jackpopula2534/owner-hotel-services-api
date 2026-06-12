import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { HireService } from './hire.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService } from '../addons/addon.service';
import { EmployeeCodeConfigService } from '../hr/employee-code-config.service';
import { RecruitmentInventoryService } from '../hr/recruitment-inventory.service';

function createMockPrisma() {
  const tx = {
    employee: { create: jest.fn().mockResolvedValue({ id: 'emp1' }), update: jest.fn() },
    hrHireRecord: { update: jest.fn().mockResolvedValue({ id: 'h1', employeeId: 'emp1' }) },
    hrEquipmentIssuance: { create: jest.fn() },
    hrCandidate: { update: jest.fn(), count: jest.fn().mockResolvedValue(1) },
    hrManpowerRequest: { update: jest.fn(), updateMany: jest.fn() },
    hrProbationRound: { create: jest.fn().mockResolvedValue({ id: 'round1' }) },
    hrProbationCheckpoint: { create: jest.fn() },
  };
  return {
    tx,
    hrCandidate: { findFirst: jest.fn() },
    hrHireRecord: { findFirst: jest.fn() },
    hrProbationRound: { findFirst: jest.fn() },
    hrEquipmentIssuance: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
}

const baseCandidate = {
  id: 'c1',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  email: 'somchai@example.com',
  phone: null,
  manpowerRequestId: 'mpr1',
  hireRecord: {
    id: 'h1',
    offerStatus: 'offered',
    offeredSalary: 18000,
    startDate: new Date('2026-07-01'),
    probationDays: 90,
  },
  manpowerRequest: {
    id: 'mpr1',
    propertyId: 'p1',
    departmentId: null,
    positionId: null,
    positionTitle: 'พนักงานต้อนรับ',
    employmentType: 'FULLTIME',
    equipmentRequests: [
      { id: 'eq1', items: [{ name: 'Uniform', qty: 2 }, { name: 'Name tag', qty: 1 }] },
    ],
  },
};

describe('HireService', () => {
  let service: HireService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HireService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: EmployeeCodeConfigService,
          useValue: { generateNextCode: jest.fn().mockResolvedValue('EMP-0042') },
        },
        {
          provide: RecruitmentInventoryService,
          useValue: {
            isEnabled: jest.fn().mockResolvedValue(false),
            reserveItems: jest.fn(),
            releaseReservation: jest.fn(),
          },
        },
        { provide: AddonService, useValue: { hasActiveAddon: jest.fn().mockResolvedValue(false) } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(HireService);
  });

  describe('hire', () => {
    it('creates employee (PENDING_START) + issuance checklists in one transaction', async () => {
      prisma.hrCandidate.findFirst.mockResolvedValue(baseCandidate);
      const result = await service.hire('c1', {}, 't1', 'u1');

      expect(prisma.tx.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeCode: 'EMP-0042',
            status: 'PENDING_START',
            baseSalary: 18000,
          }),
        }),
      );
      expect(prisma.tx.hrEquipmentIssuance.create).toHaveBeenCalledTimes(1);
      expect(prisma.tx.hrCandidate.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'hired' },
      });
      // มีคำขอเบิกที่อนุมัติแล้ว (pre-approved) → ข้ามไปขั้นรับของ (onboarding) ได้เลย
      expect(prisma.tx.hrManpowerRequest.update).toHaveBeenCalledWith({
        where: { id: 'mpr1' },
        data: { status: 'onboarding' },
      });
      expect(result.employee.id).toBe('emp1');
    });

    it('stays at "hired" (equipment stage) when no equipment approved yet', async () => {
      prisma.hrCandidate.findFirst.mockResolvedValue({
        ...baseCandidate,
        manpowerRequest: { ...baseCandidate.manpowerRequest, equipmentRequests: [] },
      });
      await service.hire('c1', {}, 't1', 'u1');
      expect(prisma.tx.hrManpowerRequest.update).toHaveBeenCalledWith({
        where: { id: 'mpr1' },
        data: { status: 'hired' },
      });
    });

    it('rejects when there is no pending offer', async () => {
      prisma.hrCandidate.findFirst.mockResolvedValue({
        ...baseCandidate,
        hireRecord: { ...baseCandidate.hireRecord, offerStatus: 'declined' },
      });
      await expect(service.hire('c1', {}, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when no email is available', async () => {
      prisma.hrCandidate.findFirst.mockResolvedValue({ ...baseCandidate, email: null });
      await expect(service.hire('c1', {}, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirmStart', () => {
    const acceptedHire = {
      id: 'h1',
      offerStatus: 'accepted',
      employeeId: 'emp1',
      probationDays: 90,
      candidate: { manpowerRequestId: 'mpr1' },
    };

    it('sets PROBATION + opens a round with 30/60 checkpoints + final 90', async () => {
      prisma.hrHireRecord.findFirst.mockResolvedValue(acceptedHire);
      prisma.hrProbationRound.findFirst.mockResolvedValue(null);
      prisma.hrEquipmentIssuance.count.mockResolvedValue(1);
      await service.confirmStart('h1', 't1', 'u1');

      expect(prisma.tx.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp1' },
          data: expect.objectContaining({ status: 'PROBATION' }),
        }),
      );
      // 30, 60 (< 90) + final 90
      expect(prisma.tx.hrProbationCheckpoint.create).toHaveBeenCalledTimes(3);
      // ผ่านขั้นอุปกรณ์แล้ว (onboarding) หรือ hired+อนุมัติพร้อมกัน → ขยับไป probation
      expect(prisma.tx.hrManpowerRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'mpr1', status: { in: ['onboarding', 'hired'] } },
        data: { status: 'probation' },
      });
    });

    it('rejects when offer is not accepted yet', async () => {
      prisma.hrHireRecord.findFirst.mockResolvedValue({ ...acceptedHire, offerStatus: 'offered', employeeId: null });
      await expect(service.confirmStart('h1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when no equipment issuance exists (mandatory equipment step not done)', async () => {
      prisma.hrHireRecord.findFirst.mockResolvedValue(acceptedHire);
      prisma.hrProbationRound.findFirst.mockResolvedValue(null);
      prisma.hrEquipmentIssuance.count.mockResolvedValue(0);
      await expect(service.confirmStart('h1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.tx.employee.update).not.toHaveBeenCalled();
    });

    it('rejects when an active round already exists', async () => {
      prisma.hrHireRecord.findFirst.mockResolvedValue(acceptedHire);
      prisma.hrProbationRound.findFirst.mockResolvedValue({ id: 'round-active' });
      await expect(service.confirmStart('h1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
