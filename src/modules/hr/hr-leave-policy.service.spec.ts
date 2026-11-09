import { Test, TestingModule } from '@nestjs/testing';
import { HrLeavePolicyService } from './hr-leave-policy.service';
import { PrismaService } from '../../prisma/prisma.service';

function createMockPrisma() {
  return {
    hrLeavePolicy: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('HrLeavePolicyService.resolveEffective', () => {
  let service: HrLeavePolicyService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HrLeavePolicyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(HrLeavePolicyService);
  });

  it('returns DEFAULT when no policy matches', async () => {
    prisma.hrLeavePolicy.findMany.mockResolvedValue([]);
    const p = await service.resolveEffective('t1', 'lt1', 5);
    expect(p).toEqual(HrLeavePolicyService.DEFAULT);
  });

  it('filters out policies above the employee tenure', async () => {
    prisma.hrLeavePolicy.findMany.mockResolvedValue([
      { id: 'a', leaveTypeId: 'lt1', minTenureMonths: 24, approvalLevels: 3, requiresAttachment: false, entitlementDays: 10, blackoutDates: [] },
    ]);
    const p = await service.resolveEffective('t1', 'lt1', 6); // 6 < 24
    expect(p).toEqual(HrLeavePolicyService.DEFAULT);
  });

  it('prefers leaveType-specific over generic, highest tenure first', async () => {
    prisma.hrLeavePolicy.findMany.mockResolvedValue([
      { id: 'generic', leaveTypeId: null, minTenureMonths: 0, approvalLevels: 1, requiresAttachment: false, entitlementDays: 6, blackoutDates: [] },
      { id: 'specific', leaveTypeId: 'lt1', minTenureMonths: 12, approvalLevels: 2, requiresAttachment: true, entitlementDays: 12, blackoutDates: ['2026-12-31'] },
    ]);
    const p = await service.resolveEffective('t1', 'lt1', 18);
    expect(p.id).toBe('specific');
    expect(p.approvalLevels).toBe(2);
    expect(p.requiresAttachment).toBe(true);
    expect(p.blackoutDates).toContain('2026-12-31');
  });
});
