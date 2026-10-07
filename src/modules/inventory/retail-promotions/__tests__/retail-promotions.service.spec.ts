import { Prisma } from '@prisma/client';
import { RetailPromotionsService } from '../retail-promotions.service';

const TENANT = 't1';
const GIFT_WH = 'wh-gift';

const promo = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'ลด 10%',
  status: 'ACTIVE',
  discountType: 'PERCENT',
  discountValue: new Prisma.Decimal(10),
  maxDiscount: null,
  minSpend: new Prisma.Decimal(0),
  eligibleItemIds: null,
  eligibleTiers: null,
  eligibleSegments: null,
  giftWarehouseId: GIFT_WH,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  perMemberLimit: null,
  gifts: [{ id: 'gift1', itemId: 'tote', quantity: 1, budgetQty: 10, issuedQty: 9 }],
  ...over,
});

const code = (over: Record<string, unknown> = {}, promoOver: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'SUMMER10',
  isActive: true,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  issuedToGuestId: null,
  promotion: promo(promoOver),
  ...over,
});

function buildDb() {
  return {
    retailPromoCode: { findFirst: jest.fn().mockResolvedValue(code()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    retailPromotion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    retailPromotionMemberUsage: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    retailPromotionGift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    retailPromotionRedemption: { create: jest.fn().mockResolvedValue({}) },
    guest: {
      findFirst: jest.fn().mockResolvedValue({ id: 'g1', firstName: 'Ann', lastName: 'B', phone: '081', email: null }),
    },
    loyaltyPoint: { findMany: jest.fn().mockResolvedValue([{ guestId: 'g1', tier: 'silver' }]) },
    crmContact: { findMany: jest.fn().mockResolvedValue([{ id: 'ct1', guestId: 'g1', segment: 'new' }]) },
    inventoryItem: { findMany: jest.fn().mockResolvedValue([{ id: 'tote', name: 'Tote', sku: 'T', unit: 'PCS' }]) },
    warehouseStock: { findMany: jest.fn().mockResolvedValue([{ itemId: 'tote', quantity: new Prisma.Decimal(5) }]) },
  };
}

const lines = [{ itemId: 'i1', quantity: 2, unitPrice: 100 }];

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return (err as { getResponse: () => { code: string } }).getResponse().code;
  }
  return undefined;
};

describe('RetailPromotionsService.evaluate', () => {
  const run = (db: ReturnType<typeof buildDb>, guestId: string | null = 'g1') =>
    new RetailPromotionsService(db as never).evaluate(db as never, TENANT, { code: ' summer10 ', guestId, lines });

  it('prices the cart and caps gift availability by the remaining budget', async () => {
    const db = buildDb();
    const ev = await run(db);
    expect(db.retailPromoCode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, code: 'SUMMER10' } }),
    );
    expect(ev.discount).toBe(20);
    expect(ev.member).toMatchObject({ guestId: 'g1', tier: 'silver', segment: 'new' });
    // คลังมี 5 แต่งบเหลือ 10 − 9 = 1
    expect(ev.gifts[0].availableQty).toBe(1);
  });

  it.each([
    ['no member', () => buildDb(), null, 'PROMO_MEMBER_REQUIRED'],
    ['unknown code', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(null); return db; }, 'g1', 'PROMO_CODE_NOT_FOUND'],
    ['used-up code', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({ maxUses: 1, usedCount: 1 })); return db; }, 'g1', 'PROMO_CODE_USED_UP'],
    ['paused promo', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({}, { status: 'PAUSED' })); return db; }, 'g1', 'PROMO_NOT_ACTIVE'],
    ['quota reached', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({}, { usageLimit: 3, usedCount: 3 })); return db; }, 'g1', 'PROMO_SOLD_OUT'],
    ['code of an automatic promotion', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({}, { autoApply: true })); return db; }, 'g1', 'PROMO_AUTO_NO_CODE'],
    ['code issued to someone else', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({ issuedToGuestId: 'g2' })); return db; }, 'g1', 'PROMO_CODE_NOT_YOURS'],
    ['tier not eligible', () => { const db = buildDb(); db.retailPromoCode.findFirst.mockResolvedValue(code({}, { eligibleTiers: ['gold'] })); return db; }, 'g1', 'PROMO_TIER_NOT_ELIGIBLE'],
    ['member limit reached', () => {
      const db = buildDb();
      db.retailPromoCode.findFirst.mockResolvedValue(code({}, { perMemberLimit: 1 }));
      db.retailPromotionMemberUsage.findFirst.mockResolvedValue({ usedCount: 1 });
      return db;
    }, 'g1', 'PROMO_MEMBER_LIMIT'],
    ['member of another tenant', () => { const db = buildDb(); db.guest.findFirst.mockResolvedValue(null); return db; }, 'g1', 'MEMBER_NOT_FOUND'],
  ])('rejects %s', async (_label, make, guestId, expected) => {
    expect(await errorCode(run(make(), guestId as string | null))).toBe(expected);
  });

  it('looks the member up inside the tenant and skips anonymized guests', async () => {
    const db = buildDb();
    await run(db);
    expect(db.guest.findFirst).toHaveBeenCalledWith({ where: { id: 'g1', tenantId: TENANT, anonymizedAt: null } });
  });
});
