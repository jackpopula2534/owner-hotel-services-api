import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebsitePublicService } from './website-public.service';
import { CreateWebsiteInquiryDto } from './dto/create-website-inquiry.dto';

const site = {
  id: 's1',
  tenantId: 't1',
  propertyId: 'p1',
  slug: 'grand',
  status: 'PUBLISHED',
  templateKey: 'classic',
  defaultLang: 'th',
  theme: {},
  draftContent: {},
  publishedContent: {
    roomTypes: { Suite: { hidden: true }, Deluxe: { displayName: { th: 'ดีลักซ์' }, order: 1 } },
  },
  seo: {},
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const isoDay = (offsetDays: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

const LIVE_CODE_ID = '11111111-1111-1111-1111-111111111111';
const DEAD_CODE_ID = '22222222-2222-2222-2222-222222222222';

function setup(live = true) {
  const prisma = {
    websiteSite: { findFirst: jest.fn().mockResolvedValue(site) },
    websiteInquiry: {
      create: jest.fn().mockResolvedValue({ id: 'i1', type: 'CONTACT', name: 'A' }),
    },
    property: {
      findFirst: jest.fn().mockResolvedValue({
        name: 'Grand',
        description: null,
        phone: '021',
        email: null,
        location: null,
        standardCheckInTime: '14:00',
        standardCheckOutTime: '12:00',
      }),
    },
    tenants: {
      findUnique: jest.fn().mockResolvedValue({ name_en: null, address: '1 Rd', province: 'CNX' }),
    },
    room: {
      findMany: jest.fn().mockResolvedValue([
        {
          type: 'Deluxe',
          price: 2500,
          maxOccupancy: 2,
          bedType: 'King',
          size: 30,
          amenities: ['WiFi'],
          images: ['https://x/1.jpg'],
          description: null,
        },
        {
          type: 'Deluxe',
          price: 2200,
          maxOccupancy: 3,
          bedType: 'King',
          size: 30,
          amenities: [{ name: 'WiFi' }, 'TV'],
          images: ['https://x/1.jpg', '/local.jpg'],
          description: 'Nice',
        },
        {
          type: 'Suite',
          price: 6000,
          maxOccupancy: 4,
          bedType: null,
          size: null,
          amenities: null,
          images: null,
          description: null,
        },
      ]),
    },
    restaurant: { findMany: jest.fn().mockResolvedValue([]) },
    review: {
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.66 }, _count: { _all: 3 } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
  };
  const entitlement = { isLive: jest.fn().mockResolvedValue(live) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const campPublic = {
    buildPayload: jest.fn().mockResolvedValue({ available: true, kind: 'camp' }),
    buildFallback: jest.fn().mockResolvedValue({ available: false }),
  };
  const promoCodes = {
    resolveOfferCodes: jest.fn().mockResolvedValue(new Map([[LIVE_CODE_ID, 'SUMMER10']])),
  };
  const svc = new WebsitePublicService(
    prisma as never,
    entitlement as never,
    notifications as never,
    campPublic as never,
    promoCodes as never,
  );
  return { svc, prisma, entitlement, notifications, campPublic, promoCodes };
}

const contact = (over: Partial<CreateWebsiteInquiryDto> = {}): CreateWebsiteInquiryDto =>
  ({ type: 'CONTACT', name: ' Alice ', phone: '0812345678', ...over }) as CreateWebsiteInquiryDto;

describe('WebsitePublicService.getPublishedSite', () => {
  it('404s for unknown/unpublished slug and only queries PUBLISHED', async () => {
    const { svc, prisma } = setup();
    prisma.websiteSite.findFirst.mockResolvedValue(null);
    await expect(svc.getPublishedSite('Nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.websiteSite.findFirst).toHaveBeenCalledWith({
      where: { slug: 'nope', status: 'PUBLISHED' },
    });
  });

  it('returns minimal fallback when add-on lapsed', async () => {
    const { svc, prisma } = setup(false);
    const res = await svc.getPublishedSite('grand');
    expect(res).toEqual({
      available: false,
      fallback: { name: 'Grand', phone: '021', address: '1 Rd CNX' },
    });
    expect(prisma.room.findMany).not.toHaveBeenCalled();
  });

  it('groups rooms by type, hides hidden types, scopes queries by tenant+property', async () => {
    const { svc, prisma } = setup();
    const res = await svc.getPublishedSite('grand');
    if (!res.available) throw new Error('expected site');
    expect(res.roomTypes).toHaveLength(1);
    expect(res.roomTypes[0]).toMatchObject({
      key: 'Deluxe',
      name: { th: 'ดีลักซ์', en: 'ดีลักซ์' },
      fromPrice: 2200,
      maxOccupancy: 3,
      amenities: ['WiFi', 'TV'],
      images: ['https://x/1.jpg'],
      description: { th: 'Nice', en: 'Nice' },
    });
    expect(res.reviews).toMatchObject({ average: 4.7, count: 3, featured: [] });
    expect(prisma.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', propertyId: 'p1' } }),
    );
    expect(prisma.review.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', booking: { propertyId: 'p1' } } }),
    );
    // never leaks room numbers / statuses
    const select = prisma.room.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('number');
    expect(select).not.toHaveProperty('status');
  });

  it('draft preview includes hidden room types', async () => {
    const { svc } = setup();
    const res = await svc.buildPayload(
      { ...site, draftContent: site.publishedContent } as never,
      'draft',
    );
    expect(res.roomTypes.map((r) => r.key).sort()).toEqual(['Deluxe', 'Suite']);
  });

  it('live site renders the published template, draft preview the current one', async () => {
    const { svc } = setup();
    const changed = { ...site, templateKey: 'playful', publishedTemplateKey: 'luxe' } as never;
    expect((await svc.buildPayload(changed, 'published')).site.templateKey).toBe('luxe');
    expect((await svc.buildPayload(changed, 'draft')).site.templateKey).toBe('playful');
  });

  describe('offers linked to room promo codes', () => {
    const offersContent = {
      sections: [
        {
          id: 'o',
          type: 'offers',
          enabled: true,
          props: {
            items: [
              { id: 'a', title: { th: 'A' }, promoCodeId: LIVE_CODE_ID },
              { id: 'b', title: { th: 'B' }, promoCodeId: DEAD_CODE_ID },
              { id: 'c', title: { th: 'C' } },
            ],
          },
        },
      ],
    };
    const offerItems = (res: Awaited<ReturnType<WebsitePublicService['buildPayload']>>) =>
      (
        res.site.content.sections.find((s) => s.type === 'offers')?.props as {
          items: Array<{ id: string; promoCode?: string | null }>;
        }
      ).items;

    it('live site fills the code and hides offers whose code is no longer usable', async () => {
      const { svc, promoCodes } = setup();
      const res = await svc.buildPayload(
        { ...site, publishedContent: offersContent } as never,
        'published',
      );
      expect(promoCodes.resolveOfferCodes).toHaveBeenCalledWith('p1', 't1', [
        LIVE_CODE_ID,
        DEAD_CODE_ID,
      ]);
      expect(offerItems(res).map((i) => [i.id, i.promoCode])).toEqual([
        ['a', 'SUMMER10'],
        ['c', null],
      ]);
    });

    it('draft preview keeps dead-code offers so the owner can fix them', async () => {
      const { svc } = setup();
      const res = await svc.buildPayload(
        { ...site, draftContent: offersContent } as never,
        'draft',
      );
      expect(offerItems(res).map((i) => [i.id, i.promoCode])).toEqual([
        ['a', 'SUMMER10'],
        ['b', null],
        ['c', null],
      ]);
    });

    it('skips the lookup when no offer links a code', async () => {
      const { svc, promoCodes } = setup();
      await svc.buildPayload(site as never, 'published');
      expect(promoCodes.resolveOfferCodes).not.toHaveBeenCalled();
    });
  });
});

describe('WebsitePublicService.createInquiry', () => {
  it('silently drops honeypot submissions', async () => {
    const { svc, prisma } = setup();
    await expect(svc.createInquiry('grand', contact({ website: 'http://spam' }))).resolves.toEqual({
      received: true,
    });
    expect(prisma.websiteSite.findFirst).not.toHaveBeenCalled();
    expect(prisma.websiteInquiry.create).not.toHaveBeenCalled();
  });

  it('rejects when site not live', async () => {
    const { svc, prisma } = setup(false);
    await expect(svc.createInquiry('grand', contact())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.websiteInquiry.create).not.toHaveBeenCalled();
  });

  it('stores contact without stay fields and notifies staff', async () => {
    const { svc, prisma, notifications } = setup();
    await svc.createInquiry('grand', contact({ checkIn: isoDay(1), adults: 2 }));
    const data = prisma.websiteInquiry.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      siteId: 's1',
      name: 'Alice',
      checkIn: null,
      adults: null,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) }),
    );
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('stores booking dates as UTC midnight', async () => {
    const { svc, prisma } = setup();
    const checkIn = isoDay(3);
    const checkOut = isoDay(5);
    await svc.createInquiry(
      'grand',
      contact({ type: 'BOOKING_REQUEST', checkIn, checkOut, adults: 2 }),
    );
    const data = prisma.websiteInquiry.create.mock.calls[0][0].data;
    expect((data.checkIn as Date).toISOString()).toBe(`${checkIn}T00:00:00.000Z`);
    expect((data.checkOut as Date).toISOString()).toBe(`${checkOut}T00:00:00.000Z`);
  });

  it.each([
    ['missing dates', undefined, undefined],
    ['past check-in', isoDay(-2), isoDay(1)],
    ['checkout before checkin', isoDay(5), isoDay(5)],
    ['too long', isoDay(1), isoDay(80)],
  ])('rejects booking request: %s', async (_label, checkIn, checkOut) => {
    const { svc, prisma } = setup();
    await expect(
      svc.createInquiry('grand', contact({ type: 'BOOKING_REQUEST', checkIn, checkOut })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.websiteInquiry.create).not.toHaveBeenCalled();
  });

  it('notification failure does not lose the inquiry', async () => {
    const { svc, prisma, notifications } = setup();
    notifications.create.mockRejectedValue(new Error('boom'));
    await expect(svc.createInquiry('grand', contact())).resolves.toEqual({ received: true });
    expect(prisma.websiteInquiry.create).toHaveBeenCalled();
  });
});
