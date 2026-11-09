import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma, RetailPromotionStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CampaignPromoCodeService,
  promoCodeExpiry,
  renderPromoMessage,
} from './campaign-promo-code.service';

const DAY = 86_400_000;

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });

describe('renderPromoMessage', () => {
  it('replaces both placeholders', () => {
    const out = renderPromoMessage('ใช้ {{promoCode}} ก่อน {{promoExpiresAt}}', 'ABCD1234', new Date('2026-12-31T05:00:00Z'));
    expect(out).toContain('ใช้ ABCD1234 ก่อน');
    expect(out).not.toContain('{{');
    expect(out).not.toContain('โค้ดของคุณ');
  });

  it('appends the code line when the body has no placeholder', () => {
    const out = renderPromoMessage('สวัสดีสมาชิก', 'ABCD1234', null);
    expect(out).toBe('สวัสดีสมาชิก\n\nโค้ดของคุณ: ABCD1234 (ใช้ได้ถึง ตามระยะเวลาโปรโมชั่น)');
  });

  it('still shows the code when the body is empty', () => {
    expect(renderPromoMessage(null, 'ZZ', null)).toBe('โค้ดของคุณ: ZZ (ใช้ได้ถึง ตามระยะเวลาโปรโมชั่น)');
  });
});

describe('promoCodeExpiry', () => {
  const now = new Date('2026-10-07T00:00:00Z');

  it('uses send + N days when the promotion ends later', () => {
    const ends = new Date(now.getTime() + 30 * DAY);
    expect(promoCodeExpiry(now, 7, ends)).toEqual(new Date(now.getTime() + 7 * DAY));
  });

  it('caps at the promotion end date', () => {
    const ends = new Date(now.getTime() + 3 * DAY);
    expect(promoCodeExpiry(now, 7, ends)).toEqual(ends);
  });

  it('falls back to whichever bound exists', () => {
    expect(promoCodeExpiry(now, null, null)).toBeNull();
    expect(promoCodeExpiry(now, 2, null)).toEqual(new Date(now.getTime() + 2 * DAY));
    const ends = new Date(now.getTime() + DAY);
    expect(promoCodeExpiry(now, null, ends)).toEqual(ends);
  });
});

describe('CampaignPromoCodeService', () => {
  let service: CampaignPromoCodeService;

  const prisma = {
    retailPromotion: { findFirst: jest.fn() },
    retailPromoCode: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    retailPromotionRedemption: { findMany: jest.fn() },
    crmCampaign: { findMany: jest.fn() },
  };

  const issueParams = {
    tenantId: 't1',
    campaignId: 'c1',
    promotionId: 'p1',
    deliveryId: 'd1',
    guestId: 'g1',
    validDays: 14,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CampaignPromoCodeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CampaignPromoCodeService);
  });

  afterEach(() => jest.resetAllMocks());

  describe('assertLinkable', () => {
    it('rejects channels that cannot carry a code', async () => {
      await expect(service.assertLinkable('t1', 'p1', 'sms')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.retailPromotion.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a promotion from another tenant / missing', async () => {
      prisma.retailPromotion.findFirst.mockResolvedValue(null);
      await expect(service.assertLinkable('t1', 'p1', 'line')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.retailPromotion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', tenantId: 't1' } }),
      );
    });

    it('rejects archived or ended promotions', async () => {
      prisma.retailPromotion.findFirst.mockResolvedValueOnce({ status: RetailPromotionStatus.ARCHIVED, endsAt: null });
      await expect(service.assertLinkable('t1', 'p1', 'line')).rejects.toBeInstanceOf(BadRequestException);
      prisma.retailPromotion.findFirst.mockResolvedValueOnce({
        status: RetailPromotionStatus.ACTIVE,
        endsAt: new Date(Date.now() - DAY),
      });
      await expect(service.assertLinkable('t1', 'p1', 'email')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an active promotion on line/email', async () => {
      prisma.retailPromotion.findFirst.mockResolvedValue({ status: RetailPromotionStatus.DRAFT, endsAt: null });
      await expect(service.assertLinkable('t1', 'p1', 'email')).resolves.toBeUndefined();
    });
  });

  describe('issueForDelivery', () => {
    it('refuses recipients without a member (guest)', async () => {
      const r = await service.issueForDelivery({ ...issueParams, guestId: null });
      expect(r.ok).toBe(false);
      expect(prisma.retailPromoCode.create).not.toHaveBeenCalled();
    });

    it('returns the existing code on queue retry (idempotent per delivery)', async () => {
      prisma.retailPromoCode.findFirst.mockResolvedValue({ id: 'pc1', code: 'OLDCODE1', expiresAt: null });
      const r = await service.issueForDelivery(issueParams);
      expect(r).toEqual({ ok: true, code: { id: 'pc1', code: 'OLDCODE1', expiresAt: null } });
      expect(prisma.retailPromoCode.create).not.toHaveBeenCalled();
    });

    it('creates a single-use UNIQUE code bound to the guest', async () => {
      prisma.retailPromoCode.findFirst.mockResolvedValue(null);
      prisma.retailPromotion.findFirst.mockResolvedValue({ status: RetailPromotionStatus.ACTIVE, endsAt: null });
      prisma.retailPromoCode.create.mockImplementation(async ({ data }) => ({
        id: 'pc1',
        code: data.code,
        expiresAt: data.expiresAt,
      }));
      const r = await service.issueForDelivery(issueParams);
      expect(r.ok).toBe(true);
      const data = prisma.retailPromoCode.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          tenantId: 't1',
          promotionId: 'p1',
          kind: 'UNIQUE',
          maxUses: 1,
          issuedToGuestId: 'g1',
          campaignId: 'c1',
          campaignDeliveryId: 'd1',
        }),
      );
      expect(data.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    });

    it('fails without creating when the promotion has ended', async () => {
      prisma.retailPromoCode.findFirst.mockResolvedValue(null);
      prisma.retailPromotion.findFirst.mockResolvedValue({
        status: RetailPromotionStatus.ACTIVE,
        endsAt: new Date(Date.now() - DAY),
      });
      const r = await service.issueForDelivery(issueParams);
      expect(r.ok).toBe(false);
      expect(prisma.retailPromoCode.create).not.toHaveBeenCalled();
    });

    it('re-rolls the code when a random code collides', async () => {
      prisma.retailPromoCode.findFirst.mockResolvedValue(null);
      prisma.retailPromotion.findFirst.mockResolvedValue({ status: RetailPromotionStatus.ACTIVE, endsAt: null });
      prisma.retailPromoCode.create
        .mockRejectedValueOnce(p2002())
        .mockResolvedValueOnce({ id: 'pc2', code: 'NEWCODE2', expiresAt: null });
      const r = await service.issueForDelivery(issueParams);
      expect(r).toEqual({ ok: true, code: { id: 'pc2', code: 'NEWCODE2', expiresAt: null } });
      expect(prisma.retailPromoCode.create).toHaveBeenCalledTimes(2);
    });

    it('returns the racing job’s code when the delivery already got one', async () => {
      prisma.retailPromoCode.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'pc9', code: 'RACED999', expiresAt: null });
      prisma.retailPromotion.findFirst.mockResolvedValue({ status: RetailPromotionStatus.ACTIVE, endsAt: null });
      prisma.retailPromoCode.create.mockRejectedValueOnce(p2002());
      const r = await service.issueForDelivery(issueParams);
      expect(r).toEqual({ ok: true, code: { id: 'pc9', code: 'RACED999', expiresAt: null } });
      expect(prisma.retailPromoCode.create).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-unique errors', async () => {
      prisma.retailPromoCode.findFirst.mockResolvedValue(null);
      prisma.retailPromotion.findFirst.mockResolvedValue({ status: RetailPromotionStatus.ACTIVE, endsAt: null });
      prisma.retailPromoCode.create.mockRejectedValue(new Error('db down'));
      await expect(service.issueForDelivery(issueParams)).rejects.toThrow('db down');
    });
  });

  it('revokeForDelivery only disables unused codes of that delivery', async () => {
    prisma.retailPromoCode.updateMany.mockResolvedValue({ count: 1 });
    await service.revokeForDelivery('t1', 'd1');
    expect(prisma.retailPromoCode.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', campaignDeliveryId: 'd1', usedCount: 0 },
      data: { isActive: false },
    });
  });

  describe('statsFor', () => {
    it('counts issued vs redeemed codes per campaign (APPLIED only)', async () => {
      prisma.retailPromoCode.findMany.mockResolvedValue([
        { id: 'a', campaignId: 'c1' },
        { id: 'b', campaignId: 'c1' },
        { id: 'c', campaignId: 'c1' },
        { id: 'd', campaignId: 'c1' },
        { id: 'e', campaignId: 'c2' },
      ]);
      prisma.retailPromotionRedemption.findMany.mockResolvedValue([
        { promoCodeId: 'a', discountAmount: new Prisma.Decimal(50), giftCost: new Prisma.Decimal(12.5) },
        { promoCodeId: 'b', discountAmount: new Prisma.Decimal(25.25), giftCost: new Prisma.Decimal(0) },
      ]);
      const stats = await service.statsFor('t1', ['c1', 'c2', 'c3']);
      expect(prisma.retailPromotionRedemption.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1', status: 'APPLIED' }) }),
      );
      expect(stats.get('c1')).toEqual({
        codesIssued: 4,
        codesRedeemed: 2,
        discountTotal: 75.25,
        giftCostTotal: 12.5,
        redemptionRate: 0.5,
      });
      expect(stats.get('c2')).toEqual(expect.objectContaining({ codesIssued: 1, codesRedeemed: 0, redemptionRate: 0 }));
      expect(stats.get('c3')).toEqual(expect.objectContaining({ codesIssued: 0, redemptionRate: 0 }));
    });

    it('does not query when there are no campaigns', async () => {
      const stats = await service.statsFor('t1', []);
      expect(stats.size).toBe(0);
      expect(prisma.retailPromoCode.findMany).not.toHaveBeenCalled();
    });
  });

  it('statsForCampaign returns null for a non-promo campaign', async () => {
    await expect(service.statsForCampaign('t1', { id: 'c1', promotionId: null })).resolves.toBeNull();
  });

  it('listForPromotion attaches promo stats to each campaign', async () => {
    prisma.crmCampaign.findMany.mockResolvedValue([{ id: 'c1', name: 'VIP' }]);
    prisma.retailPromoCode.findMany.mockResolvedValue([{ id: 'a', campaignId: 'c1' }]);
    prisma.retailPromotionRedemption.findMany.mockResolvedValue([]);
    const rows = await service.listForPromotion('t1', 'p1');
    expect(prisma.crmCampaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', promotionId: 'p1' } }),
    );
    expect(rows[0]).toEqual(expect.objectContaining({ id: 'c1', promo: expect.objectContaining({ codesIssued: 1 }) }));
  });
});
