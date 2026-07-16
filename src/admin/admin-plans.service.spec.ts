import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Feature } from '../features/entities/feature.entity';
import { AddonService } from '../modules/addons/addon.service';
import { PlanFeature } from '../plan-features/entities/plan-feature.entity';
import { Plan } from '../plans/entities/plan.entity';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPlansService } from './admin-plans.service';

/**
 * Plans carry the business line (`system`): HOTEL or CAMP. It decides which
 * add-ons the plan may bundle, so it has to survive create/update — and moving
 * a plan to the other line has to drop the add-ons that belong to the line it
 * left, or its tenants keep an entitlement the plan no longer sells.
 */
describe('AdminPlansService — business line (HOTEL vs CAMP)', () => {
  let service: AdminPlansService;

  const buildPlan = (over: Partial<Plan> = {}): Plan =>
    ({
      id: 'plan-1',
      code: 'M',
      system: 'HOTEL',
      name: 'Medium',
      priceMonthly: 2900,
      maxRooms: 50,
      maxUsers: 10,
      isActive: true,
      planFeatures: [],
      subscriptions: [],
      ...over,
    }) as Plan;

  const plansRepo = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<Plan>) => buildPlan(data)),
    save: jest.fn((plan: Plan) => Promise.resolve(plan)),
  };

  const planAddons = { findMany: jest.fn(), deleteMany: jest.fn(), groupBy: jest.fn() };
  const prismaMock = { plan_addons: planAddons };
  const addonServiceMock = { invalidateAddonCacheForPlan: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPlansService,
        { provide: getRepositoryToken(Plan), useValue: plansRepo },
        { provide: getRepositoryToken(PlanFeature), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Feature), useValue: { findOne: jest.fn() } },
        { provide: AddonService, useValue: addonServiceMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(AdminPlansService);
    jest.clearAllMocks();
    planAddons.groupBy.mockResolvedValue([]);
    planAddons.findMany.mockResolvedValue([]);
    planAddons.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('create', () => {
    it('creates a campground plan when the admin picks the CAMP line', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(null) // code-conflict check
        .mockResolvedValueOnce(buildPlan({ code: 'CAMP', system: 'CAMP' })); // findOne() at the end

      const result = await service.create({
        code: 'CAMP',
        name: 'Camp',
        priceMonthly: 990,
        maxRooms: 30,
        maxUsers: 5,
        system: 'CAMP',
      });

      expect(plansRepo.create.mock.calls[0][0].system).toBe('CAMP');
      expect(result.system).toBe('CAMP');
    });

    it('defaults a new plan to the hotel line', async () => {
      plansRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(buildPlan());

      await service.create({
        code: 'M',
        name: 'Medium',
        priceMonthly: 2900,
        maxRooms: 50,
        maxUsers: 10,
      });

      expect(plansRepo.create.mock.calls[0][0].system).toBe('HOTEL');
    });
  });

  describe('update', () => {
    it('unbundles add-ons from the old line when the plan changes line', async () => {
      const plan = buildPlan({ system: 'HOTEL' });
      plansRepo.findOne
        .mockResolvedValueOnce(plan) // load for update
        .mockResolvedValueOnce(buildPlan({ system: 'CAMP' })); // findOne() at the end
      planAddons.findMany.mockResolvedValue([
        { addon_id: 'addon-hk', add_ons: { code: 'HOUSEKEEPING_MODULE', system: 'HOTEL' } },
        { addon_id: 'addon-hr', add_ons: { code: 'HR_MODULE', system: 'BOTH' } },
      ]);

      const result = await service.update('plan-1', { system: 'CAMP' });

      expect(plan.system).toBe('CAMP');
      expect(result.system).toBe('CAMP');
      // Housekeeping is hotel-only and has to go; the BOTH module stays bundled.
      expect(planAddons.deleteMany).toHaveBeenCalledWith({
        where: { plan_id: 'plan-1', addon_id: { in: ['addon-hk'] } },
      });
      // Tenants on the plan must lose the stale entitlement immediately.
      expect(addonServiceMock.invalidateAddonCacheForPlan).toHaveBeenCalledWith('plan-1');
    });

    it('keeps every add-on when the line does not change', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(buildPlan({ system: 'HOTEL' }))
        .mockResolvedValueOnce(buildPlan({ name: 'Medium Plus' }));

      await service.update('plan-1', { name: 'Medium Plus', system: 'HOTEL' });

      expect(planAddons.findMany).not.toHaveBeenCalled();
      expect(planAddons.deleteMany).not.toHaveBeenCalled();
    });

    it('does not touch the cache when the new line breaks nothing', async () => {
      plansRepo.findOne
        .mockResolvedValueOnce(buildPlan({ system: 'HOTEL' }))
        .mockResolvedValueOnce(buildPlan({ system: 'CAMP' }));
      planAddons.findMany.mockResolvedValue([
        { addon_id: 'addon-hr', add_ons: { code: 'HR_MODULE', system: 'BOTH' } },
      ]);

      await service.update('plan-1', { system: 'CAMP' });

      expect(planAddons.deleteMany).not.toHaveBeenCalled();
      expect(addonServiceMock.invalidateAddonCacheForPlan).not.toHaveBeenCalled();
    });
  });
});
