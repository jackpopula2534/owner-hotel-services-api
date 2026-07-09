/**
 * Unit tests for SubscriptionManagementService.
 *
 * The route takes a subscriptionId straight from the request body, so ownership
 * has to be proven rather than assumed. TenantScopeMiddleware hides other
 * tenants' rows from findOne() for tenant users, but platform admins skip that
 * middleware entirely — assertCanManage() is the barrier that covers both.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionManagementService } from './subscription-management.service';
import { SubscriptionActor } from './subscription-actor';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const subscriptionOf = (tenantId: string) => ({
  id: 'sub-1',
  tenant_id: tenantId,
  start_date: new Date('2026-07-01'),
  end_date: new Date('2026-08-01'),
  plans_subscriptions_plan_idToplans: { price_monthly: 1000 },
});

describe('SubscriptionManagementService', () => {
  let service: SubscriptionManagementService;
  let subscriptions: { findOne: jest.Mock; update: jest.Mock };
  let plans: { findOne: jest.Mock };
  let invoices: { create: jest.Mock };

  beforeEach(() => {
    subscriptions = {
      findOne: jest.fn().mockResolvedValue(subscriptionOf(TENANT_A)),
      update: jest.fn().mockResolvedValue({}),
    };
    plans = { findOne: jest.fn().mockResolvedValue({ price_monthly: 2000 }) };
    invoices = { create: jest.fn().mockResolvedValue({ id: 'inv-1' }) };

    service = new SubscriptionManagementService(
      subscriptions as any,
      plans as any,
      invoices as any,
    );
  });

  const upgrade = (actor: SubscriptionActor) =>
    service.upgradePlan(actor, 'sub-1', 'plan-2', { createInvoice: false });

  describe('ownership', () => {
    it('lets a tenant upgrade its own subscription', async () => {
      await expect(upgrade({ tenantId: TENANT_A, isPlatformAdmin: false })).resolves.toBeDefined();
      expect(subscriptions.update).toHaveBeenCalledWith('sub-1', { planId: 'plan-2' });
    });

    it("rejects a tenant reaching for another tenant's subscription", async () => {
      await expect(upgrade({ tenantId: TENANT_B, isPlatformAdmin: false })).rejects.toThrow(
        ForbiddenException,
      );
      expect(subscriptions.update).not.toHaveBeenCalled();
    });

    it('rejects a caller with no tenant at all', async () => {
      await expect(upgrade({ isPlatformAdmin: false })).rejects.toThrow(ForbiddenException);
      expect(subscriptions.update).not.toHaveBeenCalled();
    });

    it('lets a platform admin upgrade any tenant’s subscription', async () => {
      await expect(upgrade({ isPlatformAdmin: true })).resolves.toBeDefined();
      expect(subscriptions.update).toHaveBeenCalled();
    });

    it('does not treat a role claim as proof of ownership', async () => {
      // 'admin' is a legacy TENANT-level role. It must not stand in for
      // isPlatformAdmin here, mirroring the tenant-scope interceptor.
      const actor = { tenantId: TENANT_B, role: 'admin' } as SubscriptionActor;

      await expect(upgrade(actor)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('lookup failures', () => {
    it('404s on an unknown subscription', async () => {
      subscriptions.findOne.mockResolvedValueOnce(null);

      await expect(upgrade({ tenantId: TENANT_A })).rejects.toThrow(NotFoundException);
    });

    it('404s on an unknown plan, after ownership passes', async () => {
      plans.findOne.mockResolvedValueOnce(null);

      await expect(upgrade({ tenantId: TENANT_A })).rejects.toThrow(NotFoundException);
      expect(subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe('invoicing', () => {
    it('skips the prorate invoice when createInvoice is false', async () => {
      await service.upgradePlan({ tenantId: TENANT_A }, 'sub-1', 'plan-2', {
        createInvoice: false,
      });

      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('issues a prorate invoice against the owning tenant by default', async () => {
      await service.upgradePlan({ tenantId: TENANT_A }, 'sub-1', 'plan-2');

      expect(invoices.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, subscriptionId: 'sub-1' }),
      );
    });
  });
});
