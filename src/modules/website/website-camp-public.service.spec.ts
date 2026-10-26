import { WebsiteCampPublicService, toMapImageUrl } from './website-camp-public.service';

const site = {
  id: 'site-1',
  tenantId: 't1',
  propertyId: 'p1',
  campgroundId: 'cg1',
  slug: 'pine',
  status: 'PUBLISHED',
  templateKey: 'fresh',
  defaultLang: 'th',
  theme: null,
  seo: null,
  publishedTheme: null,
  publishedSeo: null,
  publishedAt: null,
  draftContent: null,
  publishedContent: null,
};

const zoneRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Zone ${id}`,
  type: 'lawn',
  description: null,
  basePrice: 300,
  weekendPrice: null,
  maxGuests: 4,
  maxTents: 2,
  allowVehicle: true,
  allowPet: false,
  pricingMode: 'per_night',
  hasElectricity: false,
  electricityFee: null,
  restrictions: null,
  code: id.toUpperCase(),
  color: '#16a34a',
  pitches: [
    {
      id: `${id}-1`,
      code: `${id.toUpperCase()}1`,
      posX: 0.2,
      posY: 1.4,
      images: id === 'a' ? ['https://cdn.example.com/a1.jpg', 'javascript:x'] : null,
      sizeSqm: 40,
      rotation: id === 'a' ? 30 : 0,
      widthM: id === 'a' ? 8 : null,
      depthM: id === 'a' ? 5 : null,
    },
  ],
  ...over,
});

function setup(
  campground: Record<string, unknown> = {},
  zones = [zoneRow('a'), zoneRow('b')],
  entitled = true,
) {
  const prisma = {
    campground: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'cg1',
        name: 'Pine',
        images: [],
        mapImageUrl: '/assets/camp/pine.jpg',
        mapWidth: 1536,
        mapHeight: 1024,
        ...campground,
      }),
    },
    tenants: { findUnique: jest.fn().mockResolvedValue(null) },
    campZone: { findMany: jest.fn().mockResolvedValue(zones) },
    campFacility: {
      findMany: jest.fn().mockResolvedValue([
        {
          name: 'ห้องน้ำ',
          type: 'restroom',
          open24h: true,
          openingTime: null,
          closingTime: null,
          posX: 0.5,
          posY: -2,
        },
      ]),
    },
    campAddon: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const addonService = { hasActiveAddon: jest.fn().mockResolvedValue(entitled) };
  return {
    svc: new WebsiteCampPublicService(prisma as never, addonService as never),
    prisma,
    addonService,
  };
}

describe('toMapImageUrl', () => {
  it.each([
    ['https://cdn.example.com/map.jpg', 'https://cdn.example.com/map.jpg'],
    ['/assets/camp/pine-valley-map.jpg', '/assets/camp/pine-valley-map.jpg'],
    ['/uploads/camp/camp-1.webp', '/uploads/camp/camp-1.webp'],
    ['javascript:alert(1)', null],
    ['//evil.io/x.jpg', null],
    ['/a b".jpg', null],
    ['', null],
    [null, null],
  ])('%s → %s', (raw, expected) => {
    expect(toMapImageUrl(raw)).toBe(expected);
  });
});

describe('WebsiteCampPublicService.buildPayload — map', () => {
  it('sends the backoffice map image, pitch positions and zone colours', async () => {
    const { svc } = setup();
    const payload = await svc.buildPayload(site as never, 'published');
    const camp = payload.camp!;
    expect(camp.map).toMatchObject({
      imageUrl: '/assets/camp/pine.jpg',
      width: 1536,
      height: 1024,
    });
    expect(camp.map!.pitches).toEqual([
      {
        id: 'a-1',
        code: 'A1',
        zoneKey: 'a',
        posX: 0.2,
        posY: 1,
        images: ['https://cdn.example.com/a1.jpg'],
        rotation: 30,
        widthM: 8,
        depthM: 5,
      },
      {
        id: 'b-1',
        code: 'B1',
        zoneKey: 'b',
        posX: 0.2,
        posY: 1,
        images: [],
        rotation: 0,
        widthM: null,
        depthM: null,
      },
    ]);
    expect(camp.zones.a).toMatchObject({ code: 'A', color: '#16a34a' });
    expect(camp.facilities[0]).toMatchObject({ posX: 0.5, posY: 0 });
    // ห้ามรั่วสถานะจุด
    expect(JSON.stringify(camp.map)).not.toContain('status');
  });

  it('hides pitches of zones hidden on the published site', async () => {
    const { svc } = setup();
    const payload = await svc.buildPayload(
      { ...site, publishedContent: { roomTypes: { b: { hidden: true } } } } as never,
      'published',
    );
    expect(payload.camp!.map!.pitches.map((p) => p.zoneKey)).toEqual(['a']);
  });

  it('map is null without an image; invalid zone colours are dropped', async () => {
    const { svc } = setup({ mapImageUrl: null }, [zoneRow('a', { color: 'red;x' })]);
    const payload = await svc.buildPayload(site as never, 'published');
    expect(payload.camp!.map).toBeNull();
    expect(payload.camp!.zones.a.color).toBeNull();
  });
});

const scene = {
  version: 1,
  scale: { widthM: 400, depthM: 200 },
  northDeg: 90,
  ground: { imageUrl: '/uploads/camp/plan.png', mode: 'drape' },
  terrain: { preset: 'gentle' },
  water: [
    {
      id: 'w1',
      kind: 'pond',
      label: 'บ่อปลา',
      polygon: [
        [0.1, 0.1],
        [0.2, 0.1],
        [0.2, 0.2],
      ],
      confidence: 0.4,
      source: 'vision',
    },
  ],
  rivers: [],
  roads: [],
  forests: [],
  areas: [],
  props: [],
};

describe('WebsiteCampPublicService.buildPayload — map3d', () => {
  it('sends the published 3D scene without internal AI metadata', async () => {
    const { svc, addonService } = setup({ map3dConfig: scene });
    const { map3d } = (await svc.buildPayload(site as never, 'published')).camp!;
    expect(addonService.hasActiveAddon).toHaveBeenCalledWith('t1', 'CAMP_3D_MAP');
    expect(map3d).toMatchObject({ northDeg: 90, ground: { imageUrl: '/uploads/camp/plan.png' } });
    expect(map3d!.water[0]).toEqual({
      id: 'w1',
      kind: 'pond',
      label: 'บ่อปลา',
      polygon: scene.water[0].polygon,
    });
  });

  it('hides the scene once the add-on lapses', async () => {
    const { svc } = setup({ map3dConfig: scene }, undefined, false);
    expect((await svc.buildPayload(site as never, 'published')).camp!.map3d).toBeNull();
  });

  it('is null without a scene, without a 2D map, or when the stored scene is malformed', async () => {
    for (const cg of [
      { map3dConfig: null },
      { map3dConfig: scene, mapImageUrl: null },
      { map3dConfig: { ...scene, scale: { widthM: -1, depthM: 1 } } },
    ]) {
      const { svc } = setup(cg);
      expect((await svc.buildPayload(site as never, 'published')).camp!.map3d).toBeNull();
    }
  });

  it('falls back to painted ground when the stored image URL is not ours', async () => {
    const { svc } = setup({
      map3dConfig: { ...scene, ground: { imageUrl: 'javascript:alert(1)', mode: 'drape' } },
    });
    const { map3d } = (await svc.buildPayload(site as never, 'published')).camp!;
    expect(map3d!.ground).toEqual({ imageUrl: null, mode: 'procedural' });
  });

  it('keeps campground models but drops unsafe model URLs', async () => {
    const prop = { id: 'p1', type: 'building', x: 0.5, y: 0.5, rot: 0, sizeM: 12 };
    const { svc } = setup({
      map3dConfig: {
        ...scene,
        props: [
          { ...prop, glbUrl: '/uploads/camp/lodge.glb', confidence: 0.9 },
          { ...prop, id: 'p2', glbUrl: 'javascript:alert(1)//x.glb' },
        ],
      },
    });
    const { map3d } = (await svc.buildPayload(site as never, 'published')).camp!;
    expect(map3d!.props[0]).toEqual({ ...prop, glbUrl: '/uploads/camp/lodge.glb' });
    expect(map3d!.props[1]).not.toHaveProperty('glbUrl');
  });
});
