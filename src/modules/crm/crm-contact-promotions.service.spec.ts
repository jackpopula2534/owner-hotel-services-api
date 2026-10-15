import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmContactPromotionsService, issuedCodeState } from './crm-contact-promotions.service';

const DAY = 86_400_000;
const dec = (n: number) => new Prisma.Decimal(n);

describe('issuedCodeState', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  const base = { isActive: true, usedCount: 0, maxUses: 1, expiresAt: null };

  it('classifies codes', () => {
    expect(issuedCodeState(base, now)).toBe('available');
    expect(issuedCodeState({ ...base, usedCount: 1 }, now)).toBe('used');
    // ใช้แล้วสำคัญกว่าถูกปิด (ปิดหลังใช้ = ยังนับว่าใช้)
    expect(issuedCodeState({ ...base, usedCount: 1, isActive: false }, now)).toBe('used');
    expect(issuedCodeState({ ...base, isActive: false }, now)).toBe('inactive');
    expect(issuedCodeState({ ...base, expiresAt: new Date(now.getTime() - DAY) }, now)).toBe(
      'expired',
    );
    expect(issuedCodeState({ ...base, maxUses: null, usedCount: 5 }, now)).toBe('available');
  });
});

describe('CrmContactPromotionsService', () => {
  let service: CrmContactPromotionsService;

  const prisma = {
    crmContact: { findFirst: jest.fn() },
    retailPromotionRedemption: { findMany: jest.fn() },
    retailPromoCode: { findMany: jest.fn() },
    retailSale: { findMany: jest.fn() },
    crmCampaign: { findMany: jest.fn() },
    booking: { findMany: jest.fn() },
    propertyPromoCode: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmContactPromotionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CrmContactPromotionsService);
    prisma.booking.findMany.mockResolvedValue([]);
    prisma.propertyPromoCode.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.resetAllMocks());

  it('scopes the contact lookup to the tenant', async () => {
    prisma.crmContact.findFirst.mockResolvedValue(null);
    await expect(service.history('ct1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.crmContact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ct1', tenantId: 't1' } }),
    );
  });

  it('returns an empty history for contacts not linked to a guest', async () => {
    prisma.crmContact.findFirst.mockResolvedValue({ id: 'ct1', guestId: null });
    const r = await service.history('ct1', 't1');
    expect(r.redemptions).toEqual([]);
    expect(r.summary.redeemed).toBe(0);
    expect(prisma.retailPromotionRedemption.findMany).not.toHaveBeenCalled();
  });

  it('joins sales + campaigns and sums only APPLIED redemptions', async () => {
    prisma.crmContact.findFirst.mockResolvedValue({ id: 'ct1', guestId: 'g1' });
    prisma.retailPromotionRedemption.findMany.mockResolvedValue([
      {
        id: 'r1',
        promotionId: 'p1',
        promotion: { name: 'ลด 10%' },
        code: 'ABCD1234',
        status: 'APPLIED',
        discountAmount: dec(50),
        giftCost: dec(20),
        giftSkipped: false,
        createdAt: new Date(),
        reversedAt: null,
        saleId: 's1',
      },
      {
        id: 'r2',
        promotionId: 'p1',
        promotion: { name: 'ลด 10%' },
        code: 'WELCOME',
        status: 'REVERSED',
        discountAmount: dec(30),
        giftCost: dec(0),
        giftSkipped: true,
        createdAt: new Date(),
        reversedAt: new Date(),
        saleId: 's2',
      },
    ]);
    prisma.retailPromoCode.findMany.mockResolvedValue([
      {
        id: 'pc1',
        code: 'ABCD1234',
        promotionId: 'p1',
        promotion: { name: 'ลด 10%' },
        campaignId: 'c1',
        isActive: true,
        usedCount: 1,
        maxUses: 1,
        expiresAt: null,
        createdAt: new Date(),
      },
      {
        id: 'pc2',
        code: 'EFGH5678',
        promotionId: 'p1',
        promotion: { name: 'ลด 10%' },
        campaignId: null,
        isActive: true,
        usedCount: 0,
        maxUses: 1,
        expiresAt: new Date(Date.now() + DAY),
        createdAt: new Date(),
      },
    ]);
    prisma.retailSale.findMany.mockResolvedValue([
      { id: 's1', receiptNo: 'RS-0001', grandTotal: dec(450) },
      { id: 's2', receiptNo: 'RS-0002', grandTotal: dec(270) },
    ]);
    prisma.crmCampaign.findMany.mockResolvedValue([{ id: 'c1', name: 'VIP ตุลา' }]);

    const r = await service.history('ct1', 't1');

    expect(prisma.retailPromotionRedemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', guestId: 'g1' } }),
    );
    expect(prisma.retailPromoCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', issuedToGuestId: 'g1' } }),
    );
    expect(prisma.retailSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', id: { in: ['s1', 's2'] } } }),
    );
    expect(r.summary).toEqual({
      redeemed: 1,
      reversed: 1,
      discountTotal: 50,
      giftCostTotal: 20,
      salesTotal: 450,
      codesIssued: 2,
      codesAvailable: 1,
    });
    expect(r.redemptions[0].sale).toEqual({ id: 's1', receiptNo: 'RS-0001', grandTotal: 450 });
    expect(r.issuedCodes.map((c) => [c.code, c.state, c.campaignName])).toEqual([
      ['ABCD1234', 'used', 'VIP ตุลา'],
      ['EFGH5678', 'available', null],
    ]);
  });
  it('บิลเดียวที่มีโค้ด + โปรอัตโนมัติ: นับเป็น 1 บิล ยอดบิลไม่ซ้ำ ส่วนลดรวมทุกโปร', async () => {
    prisma.crmContact.findFirst.mockResolvedValue({ id: 'ct1', guestId: 'g1' });
    const base = {
      status: 'APPLIED',
      giftCost: dec(0),
      giftSkipped: false,
      createdAt: new Date(),
      reversedAt: null,
      saleId: 's1',
    };
    prisma.retailPromotionRedemption.findMany.mockResolvedValue([
      {
        ...base,
        id: 'r1',
        promotionId: 'p1',
        promoCodeId: 'pc1',
        promotion: { name: 'ลด 50' },
        code: 'X1',
        discountAmount: dec(50),
      },
      {
        ...base,
        id: 'r2',
        promotionId: 'p2',
        promoCodeId: null,
        promotion: { name: 'แถมแก้ว' },
        code: null,
        discountAmount: dec(0),
      },
    ]);
    prisma.retailPromoCode.findMany.mockResolvedValue([]);
    prisma.retailSale.findMany.mockResolvedValue([
      { id: 's1', receiptNo: 'RS-0001', grandTotal: dec(450) },
    ]);

    const r = await service.history('ct1', 't1');

    expect(r.summary).toMatchObject({
      redeemed: 1,
      reversed: 0,
      discountTotal: 50,
      salesTotal: 450,
    });
    expect(r.redemptions.map((x) => [x.code, x.autoApplied])).toEqual([
      ['X1', false],
      [null, true],
    ]);
  });

  describe('room promo codes', () => {
    const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

    it('lists bookings that used a hotel code and the personal codes CRM issued', async () => {
      prisma.crmContact.findFirst.mockResolvedValue({ id: 'ct1', guestId: 'g1' });
      prisma.retailPromotionRedemption.findMany.mockResolvedValue([]);
      prisma.retailPromoCode.findMany.mockResolvedValue([]);
      prisma.booking.findMany
        // การจองของแขกที่ใช้โค้ด
        .mockResolvedValueOnce([
          {
            id: 'b1',
            bookingNo: 'BK-1',
            promoCodeId: 'child-used',
            status: 'confirmed',
            checkIn: d('2026-11-01'),
            checkOut: d('2026-11-03'),
            discountAmount: 300,
            grandTotal: 2700,
            totalPrice: 3000,
            createdAt: new Date(),
          },
          {
            id: 'b2',
            bookingNo: 'BK-2',
            promoCodeId: 'public',
            status: 'cancelled',
            checkIn: d('2026-12-01'),
            checkOut: d('2026-12-02'),
            discountAmount: 100,
            grandTotal: null,
            totalPrice: 900,
            createdAt: new Date(),
          },
        ])
        // การใช้โค้ดเฉพาะคน
        .mockResolvedValueOnce([{ promoCodeId: 'child-used' }]);
      prisma.propertyPromoCode.findMany
        .mockResolvedValueOnce([
          {
            id: 'child-used',
            code: 'RUSED001',
            parentId: 'tpl',
            campaignId: 'c1',
            isActive: true,
            validUntil: null,
            createdAt: new Date(),
          },
          {
            id: 'child-open',
            code: 'ROPEN001',
            parentId: 'tpl',
            campaignId: 'c1',
            isActive: true,
            validUntil: null,
            createdAt: new Date(),
          },
          {
            id: 'child-old',
            code: 'ROLD0001',
            parentId: 'tpl',
            campaignId: 'c1',
            isActive: true,
            validUntil: d('2020-01-01'),
            createdAt: new Date(),
          },
        ])
        .mockResolvedValueOnce([
          { id: 'public', code: 'SUMMER10', parentId: null },
          { id: 'tpl', code: 'VIP15', parentId: null },
        ]);
      prisma.crmCampaign.findMany.mockResolvedValue([{ id: 'c1', name: 'VIP comeback' }]);

      const r = await service.history('ct1', 't1');

      expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        guestId: 'g1',
        promoCodeId: { not: null },
      });
      expect(prisma.propertyPromoCode.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        issuedToGuestId: 'g1',
      });
      expect(r.room.bookings.map((b) => [b.bookingNo, b.code, b.fromCampaign, b.total])).toEqual([
        ['BK-1', 'RUSED001', true, 2700],
        ['BK-2', 'SUMMER10', false, 900],
      ]);
      expect(
        r.room.issuedCodes.map((c) => [c.code, c.templateCode, c.campaignName, c.state]),
      ).toEqual([
        ['RUSED001', 'VIP15', 'VIP comeback', 'used'],
        ['ROPEN001', 'VIP15', 'VIP comeback', 'available'],
        ['ROLD0001', 'VIP15', 'VIP comeback', 'expired'],
      ]);
      // การจองที่ยกเลิกไม่นับในยอด
      expect(r.room.summary).toEqual({
        bookings: 1,
        discountTotal: 300,
        bookingsTotal: 2700,
        codesIssued: 3,
        codesAvailable: 1,
      });
    });

    it('returns an empty room section for contacts not linked to a guest', async () => {
      prisma.crmContact.findFirst.mockResolvedValue({ id: 'ct1', guestId: null });
      const r = await service.history('ct1', 't1');
      expect(r.room.bookings).toEqual([]);
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });
  });
});
