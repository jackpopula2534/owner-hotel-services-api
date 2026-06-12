import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ManpowerRequestService } from './manpower-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService } from '../addons/addon.service';
import { ApprovalFlowService, DEFAULT_FLOW_ROLES } from './approval-flow.service';
import { buildApprovalChain, approveStep } from '../../common/types/approval-chain';

function createMockPrisma() {
  return {
    hrManpowerRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ManpowerRequestService', () => {
  let service: ManpowerRequestService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManpowerRequestService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: ApprovalFlowService,
          useValue: {
            resolveRoles: jest.fn((_t: string, flow: 'manpower' | 'budget' | 'equipment') =>
              Promise.resolve(DEFAULT_FLOW_ROLES[flow]),
            ),
          },
        },
        { provide: AddonService, useValue: { hasActiveAddon: jest.fn().mockResolvedValue(false) } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(ManpowerRequestService);
  });

  describe('create', () => {
    it('generates a running requestNo MPR-YYYY-NNNN', async () => {
      const year = new Date().getFullYear();
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ requestNo: `MPR-${year}-0007` });
      prisma.hrManpowerRequest.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'm1', ...data }),
      );
      const result = await service.create(
        { positionTitle: 'พนักงานต้อนรับ', reason: 'expansion' },
        't1',
        'u1',
      );
      expect(result.requestNo).toBe(`MPR-${year}-0008`);
      expect(result.status).toBe('draft');
    });
  });

  describe('submit', () => {
    it('moves draft → pending_approval with a fresh 3-level chain', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'draft', requestNo: 'MPR-2026-0001' });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'm1', ...data }),
      );
      const result = await service.submit('m1', 't1', 'u1');
      expect(result.status).toBe('pending_approval');
      expect(result.approvalChain).toHaveLength(3);
    });

    it('rejects submitting a non-draft request', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'recruiting' });
      await expect(service.submit('m1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('approve (stage 1)', () => {
    it('partial approval keeps pending_approval', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'pending_approval',
        approvalChain: buildApprovalChain(),
      });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'm1', status: 'pending_approval', ...data }),
      );
      const result = await service.approve('m1', {}, 't1', 'u-head');
      expect(result.currentApprovalLevel).toBe(1);
      expect(result.status).toBe('pending_approval');
    });

    it('final approval → budget_pending', async () => {
      let chain = buildApprovalChain();
      chain = approveStep(chain, 'u1');
      chain = approveStep(chain, 'u2');
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'pending_approval',
        approvalChain: chain,
      });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'm1', ...data }),
      );
      const result = await service.approve('m1', {}, 't1', 'u-owner');
      expect(result.status).toBe('budget_pending');
    });

    it('rejects approving a request that is not pending', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'draft' });
      await expect(service.approve('m1', {}, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('budget (stage 2)', () => {
    it('submitBudget validates salary range', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'budget_pending' });
      await expect(
        service.submitBudget('m1', { budgetTotal: 100000, salaryRangeMin: 30000, salaryRangeMax: 20000 }, 't1', 'u1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('full budget approval → recruiting + budgetApprovedAt', async () => {
      let chain = buildApprovalChain(['hr', 'owner']);
      chain = approveStep(chain, 'u-hr');
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'budget_pending',
        budgetChain: chain,
      });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'm1', ...data }),
      );
      const result = await service.approveBudget('m1', {}, 't1', 'u-owner');
      expect(result.status).toBe('recruiting');
      expect(result.budgetApprovedAt).toBeInstanceOf(Date);
    });
  });

  describe('cancel', () => {
    it('cannot cancel after hiring', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'probation' });
      await expect(service.cancel('m1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
