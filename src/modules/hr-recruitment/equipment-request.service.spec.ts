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
