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
      images: null,
      sizeSqm: 40,
    },
  ],
  ...over,
});

function setup(campground: Record<string, unknown> = {}, zones = [zoneRow('a'), zoneRow('b')]) {
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
      findMany: jest
        .fn()
        .mockResolvedValue([
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
  return { svc: new WebsiteCampPublicService(prisma as never), prisma };
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
      { id: 'a-1', code: 'A1', zoneKey: 'a', posX: 0.2, posY: 1 },
      { id: 'b-1', code: 'B1', zoneKey: 'b', posX: 0.2, posY: 1 },
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
