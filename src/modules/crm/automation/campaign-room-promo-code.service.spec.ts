import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CampaignRoomPromoCodeService,
  roomCodeValidUntil,
} from './campaign-room-promo-code.service';

const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

const template = {
  id: 'rp1',
  tenantId: 't1',
  propertyId: 'p1',
  code: 'SUMMER10',
  description: 'ลด 10%',
  discountType: 'percentage',
  discountValue: new Prisma.Decimal(10),
  maxDiscount: new Prisma.Decimal(500),
  minNights: 2,
  minAmount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: 100,
  isActive: true,
  parentId: null,
};

describe('roomCodeValidUntil', () => {
  // 2026-10-15 20:00 เวลาไทย = 13:00Z
  const now = new Date('2026-10-15T13:00:00Z');

  it('counts N days from the Bangkok date and stores UTC midnight', () => {
    expect(roomCodeValidUntil(now, 7, null)).toEqual(day('2026-10-22'));
  });

  it('uses the Bangkok date even late at night (UTC still on the previous day)', () => {
    // 2026-10-15 23:30 ไทย = 16:30Z → +1 วัน = 16 ต.ค.
    expect(roomCodeValidUntil(new Date('2026-10-15T16:30:00Z'), 1, null)).toEqual(
      day('2026-10-16'),
    );
    // 2026-10-16 00:30 ไทย = 2026-10-15T17:30Z → +1 วัน = 17 ต.ค.
    expect(roomCodeValidUntil(new Date('2026-10-15T17:30:00Z'), 1, null)).toEqual(
      day('2026-10-17'),
    );
  });

  it('never outlives the template code', () => {
    expect(roomCodeValidUntil(now, 30, day('2026-10-20'))).toEqual(day('2026-10-20'));
    expect(roomCodeValidUntil(now, null, day('2026-10-20'))).toEqual(day('2026-10-20'));
    expect(roomCodeValidUntil(now, null, null)).toBeNull();
  });
});

describe('CampaignRoomPromoCodeService', () => {
  let prisma: {
    propertyPromoCode: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    booking: { findMany: jest.Mock };
  };
  let service: CampaignRoomPromoCodeService;

  beforeEach(() => {
    prisma = {
      propertyPromoCode: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CampaignRoomPromoCodeService(prisma as unknown as PrismaService);
  });

  describe('assertLinkable', () => {
    it('only allows LINE/email and an active template code of this tenant', async () => {
      await expect(service.assertLinkable('t1', 'rp1', 'sms')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.propertyPromoCode.findFirst.mockResolvedValueOnce(null);
      await expect(service.assertLinkable('t1', 'rp1', 'line')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
        isActive: false,
        validUntil: null,
      });
      await expect(service.assertLinkable('t1', 'rp1', 'line')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
        isActive: true,
        validUntil: day('2020-01-01'),
      });
      await expect(service.assertLinkable('t1', 'rp1', 'line')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
        isActive: true,
        validUntil: null,
      });
      await expect(service.assertLinkable('t1', 'rp1', 'email')).resolves.toBeUndefined();
      expect(prisma.propertyPromoCode.findFirst.mock.calls[0][0].where).toEqual({
        id: 'rp1',
        tenantId: 't1',
        parentId: null,
      });
    });
  });

  describe('issueForDelivery', () => {
    const params = {
      tenantId: 't1',
      campaignId: 'c1',
      roomPromoCodeId: 'rp1',
      deliveryId: 'd1',
      guestId: 'g1',
      validDays: 14,
    };

    it('needs a guest to bind the code to', async () => {
      const r = await service.issueForDelivery({ ...params, guestId: null });
      expect(r.ok).toBe(false);
      expect(prisma.propertyPromoCode.create).not.toHaveBeenCalled();
    });

    it('returns the existing code on queue retry', async () => {
      prisma.propertyPromoCode.findFirst.mockResolvedValueOnce({
        id: 'child1',
        code: 'RAAAAAAA',
        validUntil: null,
      });
      const r = await service.issueForDelivery(params);
      expect(r).toEqual({ ok: true, code: { id: 'child1', code: 'RAAAAAAA', expiresAt: null } });
      expect(prisma.propertyPromoCode.create).not.toHaveBeenCalled();
    });

    it('copies the template terms into a single-use personal code', async () => {
      prisma.propertyPromoCode.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(template);
      prisma.propertyPromoCode.create.mockImplementation(async ({ data }) => ({
        id: 'child1',
        code: data.code,
        validUntil: data.validUntil,
      }));

      const r = await service.issueForDelivery(params);

      expect(r.ok).toBe(true);
      const data = prisma.propertyPromoCode.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: 't1',
        propertyId: 'p1',
        discountType: 'percentage',
        discountValue: template.discountValue,
        maxDiscount: template.maxDiscount,
        minNights: 2,
        usageLimit: 1,
        parentId: 'rp1',
        issuedToGuestId: 'g1',
        campaignId: 'c1',
        campaignDeliveryId: 'd1',
      });
      expect(data.code).toMatch(/^R[A-Z0-9]{7}$/);
      expect(data.validUntil).toBeInstanceOf(Date);
    });

    it('refuses when the template was switched off', async () => {
      prisma.propertyPromoCode.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...template, isActive: false });
      const r = await service.issueForDelivery(params);
      expect(r.ok).toBe(false);
    });

    it('retries on a random-code collision', async () => {
      prisma.propertyPromoCode.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(template)
        .mockResolvedValueOnce(null); // หลังชน: delivery นี้ยังไม่มีโค้ด → สุ่มใหม่
      const clash = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
      prisma.propertyPromoCode.create
        .mockRejectedValueOnce(clash)
        .mockResolvedValueOnce({ id: 'child2', code: 'RBBBBBBB', validUntil: null });
      const r = await service.issueForDelivery(params);
      expect(r).toEqual({ ok: true, code: { id: 'child2', code: 'RBBBBBBB', expiresAt: null } });
      expect(prisma.propertyPromoCode.create).toHaveBeenCalledTimes(2);
    });
  });

  it('revokes only the code issued for the failed delivery', async () => {
    await service.revokeForDelivery('t1', 'd1');
    expect(prisma.propertyPromoCode.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', campaignDeliveryId: 'd1' },
      data: { isActive: false },
    });
  });

  it('measures sent → booked from real non-cancelled bookings', async () => {
    prisma.propertyPromoCode.findMany.mockResolvedValue([
      { id: 'a', campaignId: 'c1' },
      { id: 'b', campaignId: 'c1' },
      { id: 'c', campaignId: 'c1' },
      { id: 'd', campaignId: 'c1' },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        promoCodeId: 'a',
        discountAmount: new Prisma.Decimal(200),
        grandTotal: new Prisma.Decimal(1800),
        totalPrice: new Prisma.Decimal(2000),
      },
      {
        promoCodeId: 'b',
        discountAmount: null,
        grandTotal: null,
        totalPrice: new Prisma.Decimal(1000),
      },
    ]);
    prisma.propertyPromoCode.findFirst.mockResolvedValue({ code: 'SUMMER10' });

    const stats = await service.statsForCampaign('t1', { id: 'c1', roomPromoCodeId: 'rp1' });

    expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      promoCodeId: { in: ['a', 'b', 'c', 'd'] },
      status: { notIn: ['cancelled'] },
    });
    expect(stats).toEqual({
      roomPromoCodeId: 'rp1',
      templateCode: 'SUMMER10',
      codesIssued: 4,
      codesRedeemed: 2,
      bookings: 2,
      discountTotal: 200,
      revenueTotal: 2800,
      redemptionRate: 0.5,
    });
  });

  it('returns null stats for campaigns without a room code', async () => {
    expect(await service.statsForCampaign('t1', { id: 'c1', roomPromoCodeId: null })).toBeNull();
  });
});
