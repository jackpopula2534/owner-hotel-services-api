import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SelfServicePlanService } from './self-service-plan.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SelfServicePlanService', () => {
  let service: SelfServicePlanService;
  let mockSubscriptionFindFirst: jest.Mock;
  let mockPlansFindUnique: jest.Mock;
  let mockTransaction: jest.Mock;

  const subBase = {
    id: 'sub-1',
    tenant_id: 'tenant-1',
    plan_id: 'plan-current',
    status: 'active',
    start_date: new Date('2026-04-01'),
    end_date: new Date('2026-05-01'),
  };

  beforeEach(async () => {
    mockSubscriptionFindFirst = jest.fn();
    mockPlansFindUnique = jest.fn();
    mockTransaction = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfServicePlanService,
        {
          provide: PrismaService,
          useValue: {
            subscriptions: {
              findFirst: mockSubscriptionFindFirst,
            },
            plans: { findUnique: mockPlansFindUnique },
            $transaction: mockTransaction,
            // limit-check tables (none populated in unit tests → return 0)
            room: { count: jest.fn().mockResolvedValue(0) },
            userTenant: { count: jest.fn().mockResolvedValue(0) },
            property: { count: jest.fn().mockResolvedValue(0) },
          },
        },
      ],
    }).compile();

    service = module.get(SelfServicePlanService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('preview', () => {
    it('classifies upgrade and computes positive net amount', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-16'));
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockImplementation(({ where: { id } }: any) => {
        if (id === 'plan-current') {
          return Promise.resolve({
            id,
            name: 'Standard',
            price_monthly: 3000,
            is_active: 1,
            max_rooms: 50,
            max_users: 10,
            max_properties: 1,
          });
        }
        return Promise.resolve({
          id,
          name: 'Premium',
          price_monthly: 6000,
          is_active: 1,
          max_rooms: 100,
          max_users: 20,
          max_properties: 5,
        });
      });

      const result = await service.preview({
        tenantId: 'tenant-1',
        newPlanId: 'plan-premium',
      });

      expect(result.intent).toBe('upgrade');
      expect(result.netAmount).toBeGreaterThan(0);
      expect(result.proratedCharge).toBeGreaterThan(result.proratedCredit);
      expect(result.blockedReasons).toEqual([]);
    });

    it('classifies downgrade and computes negative net amount', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-16'));
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve({
          id,
          name: id === 'plan-current' ? 'Premium' : 'Basic',
          price_monthly: id === 'plan-current' ? 6000 : 1000,
          is_active: 1,
          max_rooms: 9999,
          max_users: 9999,
          max_properties: 9999,
        }),
      );

      const result = await service.preview({
        tenantId: 'tenant-1',
        newPlanId: 'plan-basic',
      });

      expect(result.intent).toBe('downgrade');
      expect(result.netAmount).toBeLessThan(0);
    });

    it('blocks downgrade when usage exceeds new plan limits', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-16'));
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve({
          id,
          name: id === 'plan-current' ? 'Premium' : 'Basic',
          price_monthly: id === 'plan-current' ? 6000 : 1000,
          is_active: 1,
          max_rooms: id === 'plan-basic' ? 5 : 100,
          max_users: 10,
          max_properties: 1,
        }),
      );

      const module = service as any;
      module.prisma.room.count = jest.fn().mockResolvedValue(50); // already 50 rooms

      const result = await service.preview({
        tenantId: 'tenant-1',
        newPlanId: 'plan-basic',
      });

      expect(result.blockedReasons.length).toBeGreaterThan(0);
      expect(result.blockedReasons[0]).toContain('ห้องพัก');
    });

    it('throws when target plan is not active', async () => {
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve({
          id,
          name: 'X',
          price_monthly: 1000,
          is_active: id === 'plan-current' ? 1 : 0,
          max_rooms: 100,
          max_users: 100,
          max_properties: 100,
        }),
      );
      await expect(
        service.preview({ tenantId: 'tenant-1', newPlanId: 'plan-disabled' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks plan change for cancelled subscription', async () => {
      mockSubscriptionFindFirst.mockResolvedValue({ ...subBase, status: 'cancelled' });
      mockPlansFindUnique.mockResolvedValue({
        id: 'p',
        name: 'X',
        price_monthly: 1000,
        is_active: 1,
        max_rooms: 100,
        max_users: 100,
        max_properties: 100,
      });
      await expect(
        service.preview({ tenantId: 'tenant-1', newPlanId: 'plan-x' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirm', () => {
    it('rejects same-plan no-op', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-16'));
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockResolvedValue({
        id: 'p',
        name: 'Same',
        price_monthly: 3000,
        is_active: 1,
        max_rooms: 100,
        max_users: 100,
        max_properties: 100,
      });
      await expect(
        service.confirm({ tenantId: 'tenant-1', newPlanId: 'plan-current' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('runs through transaction and creates invoice on upgrade', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-16'));
      mockSubscriptionFindFirst.mockResolvedValue(subBase);
      mockPlansFindUnique.mockImplementation(({ where: { id } }: any) =>
        Promise.resolve({
          id,
          name: id === 'plan-current' ? 'Standard' : 'Premium',
          price_monthly: id === 'plan-current' ? 3000 : 6000,
          is_active: 1,
          max_rooms: 100,
          max_users: 100,
          max_properties: 100,
        }),
      );

      const txCalls: any[] = [];
      mockTransaction.mockImplementation(async (fn: any) => {
        const tx = {
          subscriptions: { update: jest.fn().mockResolvedValue({}) },
          invoices: {
            create: jest.fn().mockResolvedValue({ id: 'inv-1', invoice_no: 'X' }),
          },
          billing_history: { create: jest.fn().mockResolvedValue({}) },
        };
        const r = await fn(tx);
        txCalls.push(tx);
        return r;
      });

      const result = await service.confirm({
        tenantId: 'tenant-1',
        newPlanId: 'plan-premium',
      });

      expect(result.success).toBe(true);
      expect(result.invoiceId).toBe('inv-1');
      expect(result.intent).toBe('upgrade');
      expect(txCalls[0].subscriptions.update).toHaveBeenCalled();
      expect(txCalls[0].billing_history.create).toHaveBeenCalled();
    });
  });
});
