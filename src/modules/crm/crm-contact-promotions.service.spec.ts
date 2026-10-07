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
    expect(issuedCodeState({ ...base, expiresAt: new Date(now.getTime() - DAY) }, now)).toBe('expired');
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
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CrmContactPromotionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CrmContactPromotionsService);
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
});
