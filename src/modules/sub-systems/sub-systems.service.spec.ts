import { Test, TestingModule } from '@nestjs/testing';
import { SubSystemsService } from './sub-systems.service';
import { AddonService } from '../addons/addon.service';
import { SUB_SYSTEM_ADDON_META, CORE_SUB_SYSTEMS } from './sub-systems.catalog';

/** Product line each seeded sub-system add-on belongs to (mirrors seedAddOns). */
const ADDON_SYSTEM: Record<string, string> = { CAMP_MODULE: 'CAMP' };

/** Cards exposed by add-ons that a tenant on `system` is allowed to see at all. */
function visibleAddonCardCount(system: 'HOTEL' | 'CAMP'): number {
  return Object.entries(SUB_SYSTEM_ADDON_META)
    .filter(([code]) => (ADDON_SYSTEM[code] ?? 'BOTH') === 'BOTH' || ADDON_SYSTEM[code] === system)
    .reduce((n, [, cards]) => n + cards.length, 0);
}

function visibleCoreCount(system: 'HOTEL' | 'CAMP'): number {
  return CORE_SUB_SYSTEMS.filter((c) => (c.system ?? 'BOTH') === 'BOTH' || c.system === system)
    .length;
}

/** Build fake AddonService: sub-system add-ons from the seed map + given active codes. */
function mockAddonService(activeCodes: string[], tenantSystem: 'HOTEL' | 'CAMP') {
  const subSystemAddons = Object.entries(SUB_SYSTEM_ADDON_META).map(([code, meta]) => ({
    id: `id-${code}`,
    code,
    system: ADDON_SYSTEM[code] ?? 'BOTH',
    name: `${code} name`,
    description: `${code} desc`,
    icon: 'Box',
    displayOrder: 0,
    isSubSystem: true,
    subSystemMeta: meta,
  }));

  return {
    getSubSystemAddons: jest.fn().mockResolvedValue(subSystemAddons),
    getTenantSystem: jest.fn().mockResolvedValue(tenantSystem),
    getActiveAddons: jest
      .fn()
      .mockResolvedValue(
        activeCodes.map((code) => ({ code, name: code, isActive: true, source: 'subscription', expiresAt: null })),
      ),
  };
}

async function build(activeCodes: string[], tenantSystem: 'HOTEL' | 'CAMP' = 'HOTEL') {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      SubSystemsService,
      { provide: AddonService, useValue: mockAddonService(activeCodes, tenantSystem) },
    ],
  }).compile();
  return moduleRef.get(SubSystemsService);
}

describe('SubSystemsService (add-on driven)', () => {
  it('core terminals are always available even with no add-ons', async () => {
    const res = await (await build([])).getForTenant('t');
    for (const core of CORE_SUB_SYSTEMS.filter((c) => c.system !== 'CAMP')) {
      const card = res.data.all.find((c) => c.key === core.key);
      expect(card?.available).toBe(true);
      expect(card?.requiredAddon).toBeNull();
    }
  });

  it('HR card appears + available only when HR_MODULE is active', async () => {
    const without = await (await build([])).getForTenant('t');
    expect(without.data.all.find((c) => c.key === 'hr')?.available).toBe(false); // listed but locked

    const withHr = await (await build(['HR_MODULE'])).getForTenant('t');
    const hr = withHr.data.all.find((c) => c.key === 'hr');
    expect(hr?.available).toBe(true);
    expect(hr?.requiredAddon).toBe('HR_MODULE');
    expect(hr?.launchEndpoint).toBe('/auth/hr-launch');
    expect(withHr.data.available.some((c) => c.key === 'hr')).toBe(true);
  });

  it('one add-on can expose several cards (Restaurant → POS + Kitchen)', async () => {
    const res = await (await build(['RESTAURANT_MODULE'])).getForTenant('t');
    const keys = res.data.available.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['restaurant-pos', 'kitchen-display']));
  });

  it('splits available vs locked and totals match', async () => {
    const res = await (await build(['ACCOUNTING_MODULE'])).getForTenant('t');
    expect(res.data.available.some((c) => c.key === 'accounting')).toBe(true);
    expect(res.data.locked.some((c) => c.key === 'hr')).toBe(true);
    expect(res.data.counts.available + res.data.counts.locked).toBe(res.data.counts.total);
    // total = core + every card from add-ons on this tenant's product line
    expect(res.data.counts.total).toBe(visibleCoreCount('HOTEL') + visibleAddonCardCount('HOTEL'));
  });

  it('cards are sorted by displayOrder', async () => {
    const res = await (await build(['HR_MODULE', 'CRM_MODULE'])).getForTenant('t');
    const orders = res.data.all.map((c) => c.displayOrder ?? 0);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  describe('product-line separation', () => {
    it('a hotel tenant never sees the campground terminal — not even as a locked upsell', async () => {
      const res = await (await build([], 'HOTEL')).getForTenant('t');
      expect(res.data.all.some((c) => c.key === 'camp-terminal')).toBe(false);
      expect(res.data.locked.some((c) => c.key === 'camp-terminal')).toBe(false);
    });

    it('a camp tenant sees the campground terminal and not the hotel terminal', async () => {
      const res = await (await build(['CAMP_MODULE'], 'CAMP')).getForTenant('t');
      expect(res.data.available.some((c) => c.key === 'camp-terminal')).toBe(true);
      expect(res.data.all.some((c) => c.key === 'hotel-terminal')).toBe(false);
    });

    it('cross-line modules (BOTH) stay visible to camp tenants', async () => {
      const res = await (await build(['HR_MODULE'], 'CAMP')).getForTenant('t');
      expect(res.data.available.some((c) => c.key === 'hr')).toBe(true);
    });
  });
});
