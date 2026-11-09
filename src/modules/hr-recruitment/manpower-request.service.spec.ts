import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ManpowerRequestService } from './manpower-request.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AddonService } from '../addons/addon.service';
import { ApprovalFlowService, DEFAULT_FLOW_ROLES } from './approval-flow.service';
import { buildApprovalChain, approveStep } from '../../common/types/approval-chain';
import { RecruitmentNotifierService } from './recruitment-notifier.service';

function createMockPrisma() {
  return {
    hrManpowerRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    hrDepartment: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    hrCandidate: { findMany: jest.fn().mockResolvedValue([]) },
    hrInterview: { findMany: jest.fn().mockResolvedValue([]) },
    employee: { count: jest.fn().mockResolvedValue(0) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('ManpowerRequestService', () => {
  let service: ManpowerRequestService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifier: { resolveApproverUserIds: jest.Mock; notifyUsers: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrisma();
    notifier = {
      resolveApproverUserIds: jest.fn().mockResolvedValue(['u-hr1', 'u-hr2']),
      notifyUsers: jest.fn().mockResolvedValue(2),
    };
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
        { provide: RecruitmentNotifierService, useValue: notifier },
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
      const result = await service.submit('m1', {}, 't1', 'u1');
      expect(result.status).toBe('pending_approval');
      expect(result.approvalChain).toHaveLength(3);
    });

    it('rejects submitting a non-draft request', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'recruiting' });
      await expect(service.submit('m1', {}, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resubmit after being returned requires an explanation note, then logs a resubmitted round', async () => {
      const returned = {
        id: 'm1',
        status: 'draft',
        requestNo: 'MPR-2026-0001',
        approvalChain: [{ level: 1, role: 'dept_head', status: 'rejected', approverId: 'u-head', note: 'ระบุกะงาน' }],
        approvalHistory: [
          { id: 'h1', stage: 'request', action: 'submitted', round: 1, userId: 'u1', note: null, attachments: [], at: '2026-11-01' },
          { id: 'h2', stage: 'request', action: 'returned', round: 1, userId: 'u-head', note: 'ระบุกะงาน', attachments: [], at: '2026-11-01' },
        ],
      };
      prisma.hrManpowerRequest.findFirst.mockResolvedValue(returned);
      await expect(service.submit('m1', {}, 't1', 'u1')).rejects.toThrow('ยื่นใหม่ต้องระบุ');

      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data }));
      const result = await service.submit('m1', { note: 'เพิ่มกะดึกแล้ว' }, 't1', 'u1');
      const last = result.approvalHistory.at(-1);
      expect(last).toMatchObject({ action: 'resubmitted', round: 2, note: 'เพิ่มกะดึกแล้ว' });
      expect(result.approvalChain.every((st: { status: string }) => st.status === 'pending')).toBe(true);
    });

    it('refuses attachments that were not uploaded to this request folder', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'draft', requestNo: 'MPR-2026-0001' });
      const foreign = { name: 'x.pdf', key: 'hr-recruitment/t2/m9/att-1.pdf', url: '/uploads/hr-recruitment/t2/m9/att-1.pdf', size: 1, mimeType: 'application/pdf' };
      await expect(service.submit('m1', { attachments: [foreign] }, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.hrManpowerRequest.update).not.toHaveBeenCalled();
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

  describe('findAll (bucket/search/progress)', () => {
    it('applies bucket + search and attaches department + progress funnel', async () => {
      const future = new Date(Date.now() + 86_400_000);
      prisma.hrManpowerRequest.findMany.mockResolvedValue([
        { id: 'm1', departmentId: 'd1', status: 'interviewing' },
        { id: 'm2', departmentId: null, status: 'recruiting' },
      ]);
      prisma.hrManpowerRequest.count.mockResolvedValue(2);
      prisma.hrDepartment.findMany.mockResolvedValue([{ id: 'd1', name: 'Front Office' }]);
      prisma.hrCandidate.findMany.mockResolvedValue([
        { manpowerRequestId: 'm1', status: 'applied', hireRecord: null },
        { manpowerRequestId: 'm1', status: 'interview_scheduled', hireRecord: null },
        { manpowerRequestId: 'm1', status: 'offer_made', hireRecord: null },
        { manpowerRequestId: 'm1', status: 'hired', hireRecord: { employee: { status: 'PROBATION' } } },
        { manpowerRequestId: 'm1', status: 'hired', hireRecord: { employee: { status: 'ACTIVE' } } },
        { manpowerRequestId: 'm1', status: 'hired', hireRecord: { employee: { status: 'PENDING_START' } } },
      ]);
      prisma.hrInterview.findMany.mockResolvedValue([{ scheduledAt: future, candidate: { manpowerRequestId: 'm1' } }]);

      const res = await service.findAll({ bucket: 'active', search: 'MPR' }, 't1');

      const where = prisma.hrManpowerRequest.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
      expect(where.AND).toEqual([
        { status: { notIn: ['completed', 'cancelled', 'rejected'] } },
        { OR: [{ positionTitle: { contains: 'MPR' } }, { requestNo: { contains: 'MPR' } }] },
      ]);
      const [m1, m2] = res.data as any[];
      expect(m1.department).toEqual({ id: 'd1', name: 'Front Office' });
      expect(m1.progress).toEqual({
        applicants: 6,
        newApplicants: 1,
        scheduled: 1,
        passed: 4,
        offered: 4,
        hired: 3,
        started: 2,
        passedProbation: 1,
        nextInterviewAt: future.toISOString(),
      });
      expect(m2.department).toBeNull();
      expect(m2.progress.applicants).toBe(0);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 2 });
    });
  });

  describe('create — replacementEmployeeIds', () => {
    it('rejects employee ids from another tenant', async () => {
      prisma.employee.count.mockResolvedValue(1);
      await expect(
        service.create(
          { positionTitle: 'x', reason: 'r', reasonType: 'replacement', replacementEmployeeIds: ['e1', 'e2'] },
          't1',
          'u1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.employee.count).toHaveBeenCalledWith({ where: { tenantId: 't1', id: { in: ['e1', 'e2'] } } });
    });
  });

  describe('returnForRevision', () => {
    it('rejects the current step with note and goes back to draft', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'pending_approval',
        approvalChain: buildApprovalChain(),
      });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data }));
      const result = await service.returnForRevision('m1', { note: 'แก้ JD' }, 't1', 'u-head');
      expect(result.status).toBe('draft');
      expect(result.approvalChain[0]).toMatchObject({ status: 'rejected', note: 'แก้ JD', approverId: 'u-head' });
    });

    it('only works while pending_approval', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'budget_pending' });
      await expect(service.returnForRevision('m1', { note: 'x' }, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('declineBudget', () => {
    it('rejects the budget chain and closes the request as rejected', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'budget_pending',
        budgetChain: buildApprovalChain(['hr', 'owner']),
      });
      prisma.hrManpowerRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'm1', ...data }));
      const result = await service.declineBudget('m1', { note: 'งบไม่พอ' }, 't1', 'u-owner');
      expect(result.status).toBe('rejected');
      expect(result.budgetChain[0]).toMatchObject({ status: 'rejected', note: 'งบไม่พอ' });
    });

    it('requires a submitted budget chain', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'budget_pending', budgetChain: null });
      await expect(service.declineBudget('m1', { note: 'x' }, 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remind', () => {
    it('notifies approvers of the current step and returns the role', async () => {
      let chain = buildApprovalChain();
      chain = approveStep(chain, 'u-head');
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        requestNo: 'MPR-2026-0001',
        positionTitle: 'Chef',
        status: 'pending_approval',
        approvalChain: chain,
      });
      const res = await service.remind('m1', 't1', 'u1');
      expect(res.role).toBe('hr');
      expect(res.recipients).toBe(2);
      expect(notifier.resolveApproverUserIds).toHaveBeenCalledWith('t1', 'hr');
      expect(notifier.notifyUsers).toHaveBeenCalledWith(
        't1',
        ['u-hr1', 'u-hr2'],
        expect.objectContaining({ link: '/hr/recruitment/m1' }),
      );
      const claim = prisma.hrManpowerRequest.updateMany.mock.calls[0][0];
      expect(claim.where).toMatchObject({ id: 'm1', tenantId: 't1' });
    });

    it('throttles to once per 10 minutes (429)', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({
        id: 'm1',
        status: 'budget_pending',
        budgetChain: buildApprovalChain(['hr', 'owner']),
      });
      prisma.hrManpowerRequest.updateMany.mockResolvedValue({ count: 0 });
      const err = await service.remind('m1', 't1', 'u1').catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(notifier.notifyUsers).not.toHaveBeenCalled();
    });

    it('rejects when nothing is awaiting approval', async () => {
      prisma.hrManpowerRequest.findFirst.mockResolvedValue({ id: 'm1', status: 'recruiting' });
      await expect(service.remind('m1', 't1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
