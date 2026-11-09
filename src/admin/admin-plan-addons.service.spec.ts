import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AdminPlanAddonsService } from './admin-plan-addons.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddonService } from '../modules/addons/addon.service';

/**
 * Campground is its own product line. These specs pin the rule that keeps it
 * there: the Admin "assign add-on to plan" endpoint is the one hand-operated
 * path that can re-bundle CAMP_MODULE into a hotel plan, which would silently
 * re-grant the campground module to every tenant on that plan.
 */

const HOTEL_PLAN = { id: 'plan-hotel', code: 'M', system: 'HOTEL' };
const CAMP_PLAN = { id: 'plan-camp', code: 'CAMP', system: 'CAMP' };

const CAMP_ADDON = { id: 'addon-camp', code: 'CAMP_MODULE', name: 'Campground Module', system: 'CAMP', price: 590, billing_cycle: 'monthly', category: 'CAMP', is_active: 1 };
const HR_ADDON = { id: 'addon-hr', code: 'HR_MODULE', name: 'HR Module', system: 'BOTH', price: 1200, billing_cycle: 'monthly', category: 'HR', is_active: 1 };
const HOUSEKEEPING_ADDON = { id: 'addon-hk', code: 'HOUSEKEEPING_MODULE', name: 'Housekeeping Module', system: 'HOTEL', price: 590, billing_cycle: 'monthly', category: 'HOUSEKEEPING', is_active: 1 };

const ALL_ADDONS = [CAMP_ADDON, HR_ADDON, HOUSEKEEPING_ADDON];

function buildPrisma(plan: { id: string; code: string; system: string }) {
  const planAddonRows: Array<{ id: string; plan_id: string; addon_id: string; add_ons: any }> = [];

  return {
    plans: { findUnique: jest.fn().mockResolvedValue(plan) },
    add_ons: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(ALL_ADDONS.find((a) => a.id === where.id) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(ALL_ADDONS),
    },
    plan_addons: {
      findMany: jest.fn().mockResolvedValue(planAddonRows),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `pa-${data.addon_id}`,
          plan_id: data.plan_id,
          addon_id: data.addon_id,
          add_ons: ALL_ADDONS.find((a) => a.id === data.addon_id),
        };
        planAddonRows.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

async function build(plan: { id: string; code: string; system: string }) {
  const prisma = buildPrisma(plan);
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      AdminPlanAddonsService,
      { provide: PrismaService, useValue: prisma },
      { provide: AddonService, useValue: { invalidateAddonCacheForPlan: jest.fn() } },
    ],
  }).compile();
  return { service: moduleRef.get(AdminPlanAddonsService), prisma };
}

describe('AdminPlanAddonsService — product-line separation', () => {
  it('refuses to bundle the campground module into a hotel plan', async () => {
    const { service, prisma } = await build(HOTEL_PLAN);

    await expect(
      service.assignAddonToPlan(HOTEL_PLAN.id, { addonId: CAMP_ADDON.id }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.plan_addons.create).not.toHaveBeenCalled();
  });

  it('refuses to bundle a hotel-only module into a camp plan', async () => {
    const { service, prisma } = await build(CAMP_PLAN);

    await expect(
      service.assignAddonToPlan(CAMP_PLAN.id, { addonId: HOUSEKEEPING_ADDON.id }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.plan_addons.create).not.toHaveBeenCalled();
  });

  it('still allows a cross-line (BOTH) module on a hotel plan', async () => {
    const { service, prisma } = await build(HOTEL_PLAN);

    await service.assignAddonToPlan(HOTEL_PLAN.id, { addonId: HR_ADDON.id });

    expect(prisma.plan_addons.create).toHaveBeenCalledWith({
      data: { plan_id: HOTEL_PLAN.id, addon_id: HR_ADDON.id },
    });
  });

  it('allows the campground module on a camp plan', async () => {
    const { service, prisma } = await build(CAMP_PLAN);

    await service.assignAddonToPlan(CAMP_PLAN.id, { addonId: CAMP_ADDON.id });

    expect(prisma.plan_addons.create).toHaveBeenCalledWith({
      data: { plan_id: CAMP_PLAN.id, addon_id: CAMP_ADDON.id },
    });
  });

  it('does not even offer the campground module as available on a hotel plan', async () => {
    const { service } = await build(HOTEL_PLAN);

    const res = await service.getPlanAddons(HOTEL_PLAN.id);
    const codes = res.availableAddons.map((a) => a.code);

    expect(codes).not.toContain('CAMP_MODULE');
    expect(codes).toEqual(expect.arrayContaining(['HR_MODULE', 'HOUSEKEEPING_MODULE']));
  });
});
