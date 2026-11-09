import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EquipmentRequestService } from './equipment-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { ApprovalFlowService, DEFAULT_FLOW_ROLES } from './approval-flow.service';
import { RecruitmentInventoryService } from '../hr/recruitment-inventory.service';

function createMockPrisma() {
  return {
    hrEquipmentRequest: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    hrManpowerRequest: {
      findFirst: jest.fn(),
    },
    hrCandidate: {
      findMany: jest.fn(),
    },
  };
}

describe('EquipmentRequestService.update', () => {
  let service: EquipmentRequestService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquipmentRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: ApprovalFlowService,
          useValue: { resolveRoles: jest.fn().mockResolvedValue(DEFAULT_FLOW_ROLES.equipment) },
        },
        {
          provide: RecruitmentInventoryService,
          useValue: { isEnabled: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();
    service = module.get(EquipmentRequestService);
  });

  it('edits items and recomputes totalCost for a pending request', async () => {
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue({ id: 'e1', tenantId: 't1', status: 'pending' });
    prisma.hrEquipmentRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'e1', ...data }));

    const result = await service.update(
      'e1',
      { items: [{ name: 'เสื้อยูนิฟอร์ม', qty: 2, estimatedCost: 150 }] },
      't1',
      'u1',
    );

    expect(prisma.hrEquipmentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e1' } }),
    );
    expect(result.totalCost).toBe(300);
    expect(result.items).toEqual([
      { name: 'เสื้อยูนิฟอร์ม', qty: 2, estimatedCost: 150, note: null },
    ]);
  });

  it('rejects editing when the request is no longer pending', async () => {
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue({ id: 'e1', tenantId: 't1', status: 'approved' });

    await expect(
      service.update('e1', { items: [{ name: 'x', qty: 1 }] }, 't1', 'u1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.hrEquipmentRequest.update).not.toHaveBeenCalled();
  });

  it('rejects an empty items list', async () => {
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue({ id: 'e1', tenantId: 't1', status: 'pending' });

    await expect(service.update('e1', { items: [] }, 't1', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when the request does not exist', async () => {
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.update('missing', { items: [{ name: 'x', qty: 1 }] }, 't1', 'u1'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('EquipmentRequestService.create (per-employee requisition)', () => {
  let service: EquipmentRequestService;
  let prisma: ReturnType<typeof createMockPrisma>;

  const ITEMS = [{ name: 'เสื้อยูนิฟอร์ม', qty: 1, estimatedCost: 150 }];

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquipmentRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: ApprovalFlowService,
          useValue: { resolveRoles: jest.fn().mockResolvedValue(DEFAULT_FLOW_ROLES.equipment) },
        },
        {
          provide: RecruitmentInventoryService,
          useValue: { isEnabled: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();
    service = module.get(EquipmentRequestService);

    prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', requestNo: 'MPR-1', status: 'hired' });
    prisma.hrEquipmentRequest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'e-new', ...data }));
  });

  it('requires employeeId when the manpower request has hired employees', async () => {
    prisma.hrCandidate.findMany.mockResolvedValue([{ hireRecord: { employeeId: 'emp-1' } }]);

    await expect(service.create('m1', { items: ITEMS }, 't1', 'u1')).rejects.toThrow(BadRequestException);
    expect(prisma.hrEquipmentRequest.create).not.toHaveBeenCalled();
  });

  it('rejects an employeeId that is not a hired employee of the request', async () => {
    prisma.hrCandidate.findMany.mockResolvedValue([{ hireRecord: { employeeId: 'emp-1' } }]);

    await expect(
      service.create('m1', { employeeId: 'emp-other', items: ITEMS }, 't1', 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate active requisition for the same employee', async () => {
    prisma.hrCandidate.findMany.mockResolvedValue([{ hireRecord: { employeeId: 'emp-1' } }]);
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue({ id: 'existing', status: 'pending' });

    await expect(
      service.create('m1', { employeeId: 'emp-1', items: ITEMS }, 't1', 'u1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.hrEquipmentRequest.create).not.toHaveBeenCalled();
  });

  it('creates a requisition bound to a valid hired employee', async () => {
    prisma.hrCandidate.findMany.mockResolvedValue([
      { hireRecord: { employeeId: 'emp-1' } },
      { hireRecord: { employeeId: 'emp-2' } },
    ]);
    prisma.hrEquipmentRequest.findFirst.mockResolvedValue(null); // no duplicate

    const result = await service.create('m1', { employeeId: 'emp-2', items: ITEMS }, 't1', 'u1');

    expect(prisma.hrEquipmentRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employeeId: 'emp-2', manpowerRequestId: 'm1' }) }),
    );
    expect(result.employeeId).toBe('emp-2');
  });

  it('allows a request without employeeId when no one is hired yet (backward-compat)', async () => {
    prisma.hrCandidate.findMany.mockResolvedValue([]); // no hired employees

    const result = await service.create('m1', { items: ITEMS }, 't1', 'u1');

    expect(prisma.hrEquipmentRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employeeId: null }) }),
    );
    expect(result.employeeId).toBeNull();
  });
});
