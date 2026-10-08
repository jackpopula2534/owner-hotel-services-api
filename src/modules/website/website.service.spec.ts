import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WebsiteService } from './website.service';

const baseSite = {
  id: 's1',
  tenantId: 't1',
  propertyId: 'p1',
  slug: 'grand',
  status: 'DRAFT',
  templateKey: 'classic',
  defaultLang: 'th',
  theme: { logoUrl: 'https://x/logo.png' },
  draftContent: {
    sections: [{ type: 'hero', enabled: true, order: 0, props: { headline: { th: '<b>Hi</b>' } } }],
  },
  publishedContent: null,
  seo: {},
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup(eligibility: { ok: boolean; reason?: string } = { ok: true }) {
  const prisma = {
    websiteSite: {
      findMany: jest.fn().mockResolvedValue([baseSite]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(baseSite),
      update: jest.fn().mockResolvedValue(baseSite),
    },
    websiteInquiry: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    property: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'p1',
        name: 'Grand',
        phone: '02',
        email: null,
        description: 'Old town',
      }),
    },
    restaurant: { count: jest.fn().mockResolvedValue(1) },
    booking: { findFirst: jest.fn() },
    review: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // findFirst: admin lookups by {id, tenantId} → baseSite; slug lookups → null by default
  prisma.websiteSite.findFirst.mockImplementation(({ where }) =>
    Promise.resolve(where.id === 's1' && where.tenantId === 't1' ? baseSite : null),
  );
  const tenantContext = { runUnscoped: jest.fn((fn: () => unknown) => fn()) };
  const storage = { saveMany: jest.fn().mockResolvedValue([{ url: 'https://cdn/a.jpg' }]) };
  const config = { get: jest.fn().mockReturnValue('staysync.io') };
  const entitlement = { checkPublishable: jest.fn().mockResolvedValue(eligibility) };
  const publicService = { buildPayload: jest.fn().mockResolvedValue({ available: true }) };
  const svc = new WebsiteService(
    prisma as never,
    tenantContext as never,
    storage as never,
    config as never,
    entitlement as never,
    publicService as never,
  );
  return { svc, prisma, tenantContext, storage, entitlement, publicService };
}

describe('WebsiteService sites', () => {
  it('getSite is tenant-scoped and decorates host + eligibility', async () => {
    const { svc } = setup({ ok: false, reason: 'TRIAL' });
    await expect(svc.getSite('s1', 'other-tenant')).rejects.toBeInstanceOf(NotFoundException);
    const site = await svc.getSite('s1', 't1');
    expect(site.publicHost).toBe('grand.staysync.io');
    expect(site.eligibility).toEqual({ ok: false, reason: 'TRIAL' });
  });

  it('createSite: one per tenant', async () => {
    const { svc, prisma } = setup();
    prisma.websiteSite.count.mockResolvedValue(1);
    await expect(svc.createSite('t1', { slug: 'new-one' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('createSite: rejects invalid (400) and taken (409) slugs, checks uniqueness unscoped', async () => {
    const { svc, prisma, tenantContext } = setup();
    await expect(svc.createSite('t1', { slug: 'admin' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.websiteSite.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(svc.createSite('t1', { slug: 'taken' })).rejects.toBeInstanceOf(ConflictException);
    expect(tenantContext.runUnscoped).toHaveBeenCalled();
  });

  it('createSite: property must belong to tenant', async () => {
    const { svc, prisma } = setup();
    prisma.property.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.createSite('t1', { slug: 'grand-2', propertyId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.property.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) }),
    );
  });

  it('createSite: builds defaults from property', async () => {
    const { svc, prisma } = setup();
    await svc.createSite('t1', { slug: ' Grand-2 ', templateKey: 'fresh' });
    const data = prisma.websiteSite.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      propertyId: 'p1',
      slug: 'grand-2',
      templateKey: 'fresh',
    });
    expect(data.theme).toMatchObject({ primary: '#0f766e' });
    expect(data.seo.description.th).toBe('Old town');
    const dining = data.draftContent.sections.find((s: { type: string }) => s.type === 'dining');
    expect(dining.enabled).toBe(true);
  });

  it('maps P2002 race to 409', async () => {
    const { svc, prisma } = setup();
    prisma.websiteSite.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(svc.createSite('t1', { slug: 'grand-2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updateSite: sanitizes content, keeps logo on template switch, skips unchanged slug', async () => {
    const { svc, prisma, tenantContext } = setup();
    await svc.updateSite('s1', 't1', {
      slug: 'GRAND',
      templateKey: 'fresh',
      content: { sections: [{ type: 'hero', props: { images: ['javascript:x'] } }] },
    });
    expect(tenantContext.runUnscoped).not.toHaveBeenCalled();
    const data = prisma.websiteSite.update.mock.calls[0][0].data;
    expect(data.slug).toBeUndefined();
    expect(data.theme).toEqual({
      primary: '#0f766e',
      accent: '#f59e0b',
      font: 'sans',
      logoUrl: 'https://x/logo.png',
    });
    const hero = data.draftContent.sections.find((s: { type: string }) => s.type === 'hero');
    expect(hero.props.images).toEqual([]);
  });

  it('updateSite: slug change excludes own id from uniqueness check', async () => {
    const { svc, prisma } = setup();
    await svc.updateSite('s1', 't1', { slug: 'grand-new' });
    expect(prisma.websiteSite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'grand-new', id: { not: 's1' } } }),
    );
    expect(prisma.websiteSite.update.mock.calls[0][0].data.slug).toBe('grand-new');
  });
});

describe('WebsiteService publish', () => {
  it.each(['TRIAL', 'ADDON_REQUIRED', 'WRONG_PRODUCT_LINE'])(
    'blocks %s with coded 403',
    async (reason) => {
      const { svc, prisma } = setup({ ok: false, reason });
      const err = await svc.publish('s1', 't1').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: `WEBSITE_PUBLISH_${reason}` });
      expect(prisma.websiteSite.update).not.toHaveBeenCalled();
    },
  );

  it('copies sanitized draft to published', async () => {
    const { svc, prisma } = setup();
    await svc.publish('s1', 't1');
    const data = prisma.websiteSite.update.mock.calls[0][0].data;
    expect(data.status).toBe('PUBLISHED');
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(data.publishedContent.sections).toHaveLength(8);
  });

  it('publish of another tenant site 404s before eligibility', async () => {
    const { svc, entitlement } = setup();
    await expect(svc.publish('s1', 't2')).rejects.toBeInstanceOf(NotFoundException);
    expect(entitlement.checkPublishable).not.toHaveBeenCalled();
  });
});

describe('WebsiteService inquiries', () => {
  it('lists tenant-scoped with paging', async () => {
    const { svc, prisma } = setup();
    const res = await svc.listInquiries('t1', { status: 'NEW', page: 2, limit: 10 } as never);
    expect(res).toEqual({ data: [], total: 0, page: 2, limit: 10 });
    expect(prisma.websiteInquiry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', status: 'NEW' }, skip: 10, take: 10 }),
    );
  });

  it('rejects linking a booking from another tenant', async () => {
    const { svc, prisma } = setup();
    prisma.websiteInquiry.findFirst.mockResolvedValue({ id: 'i1' });
    prisma.booking.findFirst.mockResolvedValue(null);
    await expect(
      svc.updateInquiry('i1', 't1', { bookingId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '11111111-1111-1111-1111-111111111111', tenantId: 't1' },
      }),
    );
  });

  it('linking a booking marks CONVERTED', async () => {
    const { svc, prisma } = setup();
    prisma.websiteInquiry.findFirst.mockResolvedValue({ id: 'i1' });
    prisma.booking.findFirst.mockResolvedValue({ id: 'b1' });
    await svc.updateInquiry('i1', 't1', { bookingId: 'b1' });
    expect(prisma.websiteInquiry.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { bookingId: 'b1', status: 'CONVERTED' },
    });
  });

  it('404s for inquiry of another tenant', async () => {
    const { svc, prisma } = setup();
    prisma.websiteInquiry.findFirst.mockResolvedValue(null);
    await expect(svc.updateInquiry('i1', 't2', { status: 'CLOSED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
