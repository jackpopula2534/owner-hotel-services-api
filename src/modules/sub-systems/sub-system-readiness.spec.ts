import { ConflictException } from '@nestjs/common';
import {
  assertSubSystemReady,
  getSubSystemReadiness,
  SUB_SYSTEM_NOT_READY,
} from './sub-system-readiness';

interface Counts {
  restaurant?: number;
  menuItem?: number;
  campground?: number;
  campPitch?: number;
  property?: number;
  room?: number;
}

function mockPrisma(counts: Counts) {
  const model = (n = 0) => ({ count: jest.fn().mockResolvedValue(n) });
  return {
    restaurant: model(counts.restaurant),
    menuItem: model(counts.menuItem),
    campground: model(counts.campground),
    campPitch: model(counts.campPitch),
    property: model(counts.property),
    room: model(counts.room),
  };
}

const run = (counts: Counts) => getSubSystemReadiness(mockPrisma(counts) as never, 't1');
const codes = (r: { missing: { code: string }[] }) => r.missing.map((m) => m.code);

describe('getSubSystemReadiness', () => {
  it('brand-new tenant: nothing is ready, each terminal names its first missing step', async () => {
    const r = await run({});
    expect(r.pos.ready).toBe(false);
    expect(codes(r.pos)).toEqual(['NO_RESTAURANT']);
    expect(codes(r['pos-kitchen'])).toEqual(['NO_RESTAURANT']);
    expect(codes(r['camp-terminal'])).toEqual(['NO_CAMPGROUND']);
    expect(codes(r['hotel-terminal'])).toEqual(['NO_PROPERTY']);
  });

  it('restaurant without a menu: POS still blocked, kitchen display opens', async () => {
    const r = await run({ restaurant: 1 });
    expect(codes(r.pos)).toEqual(['NO_MENU']);
    expect(r['pos-kitchen']).toEqual({ ready: true, missing: [] });
  });

  it('campground without pitches is not ready', async () => {
    const r = await run({ campground: 1 });
    expect(codes(r['camp-terminal'])).toEqual(['NO_PITCH']);
  });

  it('fully set-up tenant is ready everywhere', async () => {
    const r = await run({ restaurant: 1, menuItem: 3, campground: 1, campPitch: 4, property: 1, room: 2 });
    expect(Object.values(r).every((x) => x.ready)).toBe(true);
  });

  it('scopes every count to the tenant', async () => {
    const prisma = mockPrisma({});
    await getSubSystemReadiness(prisma as never, 't1');
    for (const m of Object.values(prisma)) {
      expect(m.count).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    }
  });

  it('no tenant → no claims (nothing counted across tenants)', async () => {
    const prisma = mockPrisma({});
    expect(await getSubSystemReadiness(prisma as never, '')).toEqual({});
    expect(prisma.restaurant.count).not.toHaveBeenCalled();
  });
});

describe('assertSubSystemReady', () => {
  it('throws 409 SUB_SYSTEM_NOT_READY with the missing items', async () => {
    const err = await assertSubSystemReady(mockPrisma({}) as never, 't1', 'pos').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      code: SUB_SYSTEM_NOT_READY,
      subSystem: 'pos',
      missing: [{ code: 'NO_RESTAURANT', setupHref: '/dashboard/restaurant' }],
    });
  });

  it('passes when ready, and for terminals with no modelled requirement', async () => {
    const prisma = mockPrisma({ restaurant: 1, menuItem: 1 });
    await expect(assertSubSystemReady(prisma as never, 't1', 'pos')).resolves.toBeUndefined();
    await expect(assertSubSystemReady(prisma as never, 't1', 'accounting')).resolves.toBeUndefined();
  });
});
