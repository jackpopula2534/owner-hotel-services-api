import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ApprovalFlowService, DEFAULT_FLOW_ROLES } from './approval-flow.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    hrApprovalFlow: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn((args: any) => Promise.resolve({ id: 'f1', ...args.data })),
      upsert: jest.fn((args: any) => Promise.resolve({ id: 'f1', isActive: true, ...args.create, ...args.update })),
    },
  };
}

describe('ApprovalFlowService', () => {
  let service: ApprovalFlowService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ApprovalFlowService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ApprovalFlowService);
  });

  it('getAll lazily creates defaults for missing flows', async () => {
    const all = await service.getAll('t1');
    expect(all).toHaveLength(3);
    expect(prisma.hrApprovalFlow.create).toHaveBeenCalledTimes(3);
    const manpower = all.find((f) => f.flowType === 'manpower');
    expect(manpower?.steps.map((s) => s.role)).toEqual(DEFAULT_FLOW_ROLES.manpower);
  });

  it('resolveRoles returns configured roles when present', async () => {
    prisma.hrApprovalFlow.findUnique.mockResolvedValue({
      isActive: true,
      steps: [{ role: 'hr' }, { role: 'owner' }],
    });
    const roles = await service.resolveRoles('t1', 'manpower');
    expect(roles).toEqual(['hr', 'owner']);
  });

  it('resolveRoles falls back to defaults on error/empty', async () => {
    prisma.hrApprovalFlow.findUnique.mockResolvedValue(null);
    const roles = await service.resolveRoles('t1', 'budget');
    expect(roles).toEqual(DEFAULT_FLOW_ROLES.budget);
  });

  it('update rejects an invalid role', async () => {
    await expect(service.update('t1', 'manpower', [{ role: 'ceo' }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update rejects an unknown flow type', async () => {
    await expect(service.update('t1', 'nonsense', [{ role: 'hr' }])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update persists normalized steps', async () => {
    const res = await service.update('t1', 'equipment', [{ role: 'dept_head', label: 'หัวหน้าครัว' }, { role: 'owner' }]);
    expect(res.steps).toEqual([
      { role: 'dept_head', label: 'หัวหน้าครัว' },
      { role: 'owner', label: null },
    ]);
  });
});
