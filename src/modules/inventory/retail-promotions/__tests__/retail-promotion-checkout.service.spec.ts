import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RetailPromotionCheckoutService, AppliedPromotion } from '../retail-promotion-checkout.service';

const TENANT = 't1';
const lines = [{ itemId: 'i1', quantity: 2, unitPrice: 300 }];
const member = {
  guestId: 'g1',
  name: 'Ann',
  phone: null,
  email: null,
  tier: 'silver',
  segment: 'vip',
  contactId: 'ct1',
};

const autoPromo = (over: Record<string, unknown> = {}) => ({
  id: 'auto1',
  name: 'ซื้อครบ 500 รับถุงผ้า',
  status: 'ACTIVE',
  autoApply: true,
  stackable: true,
  discountType: 'NONE',
  discountValue: new Prisma.Decimal(0),
  maxDiscount: null,
  minSpend: new Prisma.Decimal(500),
  eligibleItemIds: null,
  eligibleTiers: null,
  eligibleSegments: null,
  giftWarehouseId: 'wh-gift',
  usageLimit: null,
  usedCount: 0,
  perMemberLimit: null,
  gifts: [{ id: 'gift-a', itemId: 'tote', quantity: 1, budgetQty: null, issuedQty: 0 }],
  ...over,
});

const gift = (over: Record<string, unknown> = {}) => ({
  giftId: 'gift-a',
  itemId: 'tote',
  name: 'Tote',
  sku: 'T',
  unit: 'PCS',
  quantity: 1,
  budgetQty: null,
  availableQty: 5,
  ...over,
});

const evaluatedCode = (over: Record<string, unknown> = {}) => ({
  promotion: {
    id: 'code-p',
    name: 'ลด 10%',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscount: null,
    minSpend: 0,
    usageLimit: null,
    perMemberLimit: null,
    giftWarehouseId: null,
    stackable: true,
    ...over,
  },
  code: { id: 'c1', code: 'SUMMER10', maxUses: null },
  member,
  netSubtotal: 600,
  discount: 60,
  gifts: [],
});

function setup() {
  const db = {
    retailPromotion: {
      findMany: jest.fn().mockResolvedValue([autoPromo()]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    retailPromoCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    retailPromotionMemberUsage: {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    retailPromotionGift: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    retailPromotionRedemption: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const promotions = {
    resolveMember: jest.fn().mockResolvedValue(member),
    evaluate: jest.fn().mockResolvedValue(evaluatedCode()),
    evaluateGifts: jest.fn().mockResolvedValue([gift()]),
    memberUsedCount: jest.fn().mockResolvedValue(0),
  };
  const service = new RetailPromotionCheckoutService(db as never, promotions as never);
  const price = (input: {
    code?: string;
    guestId?: string | null;
    lines?: typeof lines;
    acceptWithoutGift?: boolean;
  }) => service.priceBill(db as never, TENANT, { lines, mode: 'sale', ...input });
  return { db, promotions, service, price };
}

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return ((err as BadRequestException).getResponse() as { code: string }).code;
  }
  return undefined;
};

describe('RetailPromotionCheckoutService.priceBill', () => {
  it('an open auto gift promotion applies without a member or code', async () => {
    const { price, promotions } = setup();
    const bill = await price({});
    expect(promotions.resolveMember).not.toHaveBeenCalled();
    expect(bill.member).toBeNull();
    expect(bill.applied).toHaveLength(1);
    expect(bill.applied[0]).toMatchObject({ autoApplied: true, code: null, discount: 0 });
    expect(bill.applied[0].grantedGifts.map((g) => g.itemId)).toEqual(['tote']);
  });

  it('below min spend → upsell hint with the shortfall', async () => {
    const { price } = setup();
    const bill = await price({ lines: [{ itemId: 'i1', quantity: 1, unitPrice: 380 }] });
    expect(bill.applied).toEqual([]);
    expect(bill.skipped).toEqual([
      expect.objectContaining({ promotionId: 'auto1', reason: 'MIN_SPEND', shortBy: 120 }),
    ]);
  });

  it('a restricted auto promotion needs a member, then checks the audience', async () => {
    const { price, db, promotions } = setup();
    db.retailPromotion.findMany.mockResolvedValue([autoPromo({ eligibleTiers: ['gold'] })]);
    expect((await price({})).skipped[0].reason).toBe('MEMBER_REQUIRED');
    const bill = await price({ guestId: 'g1' });
    expect(promotions.resolveMember).toHaveBeenCalledWith(db, TENANT, 'g1');
    expect(bill.skipped[0]).toMatchObject({ reason: 'NOT_ELIGIBLE' });
    expect(bill.applied).toEqual([]);
  });

  it("per-member limit counts this member's past uses", async () => {
    const { price, db, promotions } = setup();
    db.retailPromotion.findMany.mockResolvedValue([autoPromo({ perMemberLimit: 1 })]);
    promotions.memberUsedCount.mockResolvedValue(1);
    expect((await price({ guestId: 'g1' })).skipped[0].reason).toBe('NOT_ELIGIBLE');
  });

  it('code + stackable auto promotion both apply', async () => {
    const { price } = setup();
    const bill = await price({ code: 'SUMMER10', guestId: 'g1' });
    expect(bill.applied.map((a) => [a.promotion.id, a.autoApplied])).toEqual([
      ['code-p', false],
      ['auto1', true],
    ]);
  });

  it('a non-stackable code blocks every auto promotion', async () => {
    const { price, promotions } = setup();
    promotions.evaluate.mockResolvedValue(evaluatedCode({ stackable: false }));
    const bill = await price({ code: 'SUMMER10', guestId: 'g1' });
    expect(bill.applied.map((a) => a.promotion.id)).toEqual(['code-p']);
    expect(bill.skipped).toEqual([expect.objectContaining({ promotionId: 'auto1', reason: 'CODE_NOT_STACKABLE' })]);
  });

  it('two auto promotions sharing one gift in stock: the second sees the reservation and is skipped', async () => {
    const { price, db, promotions } = setup();
    db.retailPromotion.findMany.mockResolvedValue([autoPromo(), autoPromo({ id: 'auto2', name: 'แถมอีก' })]);
    promotions.evaluateGifts.mockResolvedValue([gift({ availableQty: 1 })]);
    const bill = await price({});
    expect(bill.applied.map((a) => a.promotion.id)).toEqual(['auto1']);
    expect(bill.skipped).toEqual([expect.objectContaining({ promotionId: 'auto2', reason: 'GIFT_OUT' })]);
  });

  it('only loads active auto promotions inside their window for this tenant', async () => {
    const { price, db } = setup();
    await price({});
    expect(db.retailPromotion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, autoApply: true, status: 'ACTIVE' }),
      }),
    );
  });

  it('sale mode: code gift shortage throws unless the customer accepts the discount only', async () => {
    const { price, promotions } = setup();
    promotions.evaluate.mockResolvedValue({
      ...evaluatedCode({ giftWarehouseId: 'wh-gift' }),
      gifts: [gift({ availableQty: 0 })],
    });
    expect(await errorCode(price({ code: 'SUMMER10', guestId: 'g1' }))).toBe('PROMO_GIFT_SHORTAGE');
    const bill = await price({ code: 'SUMMER10', guestId: 'g1', acceptWithoutGift: true });
    expect(bill.applied[0]).toMatchObject({ giftSkipped: true, grantedGifts: [] });
  });
});

describe('RetailPromotionCheckoutService.recordRedemptionsWithin', () => {
  const applied = (over: Partial<AppliedPromotion> = {}): AppliedPromotion & { giftCost: number } => ({
    promotion: {
      id: 'p1',
      name: 'ลด',
      usageLimit: 10,
      perMemberLimit: 2,
      giftWarehouseId: 'wh-gift',
      stackable: true,
    },
    code: { id: 'c1', code: 'SUMMER10', maxUses: 5 },
    autoApplied: false,
    discount: 20,
    gifts: [gift({ budgetQty: 10 })],
    grantedGifts: [gift({ budgetQty: 10 })],
    giftSkipped: false,
    giftCost: 40,
    ...over,
  });
  const record = (
    db: ReturnType<typeof setup>['db'],
    service: RetailPromotionCheckoutService,
    list = [applied()],
    m: typeof member | null = member,
  ) =>
    service.recordRedemptionsWithin(db as never, {
      tenantId: TENANT,
      userId: 'u1',
      saleId: 's1',
      member: m,
      contactId: m ? 'ct1' : null,
      applied: list,
    });

  it('consumes every quota conditionally and writes the redemption', async () => {
    const { db, service } = setup();
    await record(db, service);
    expect(db.retailPromotion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedCount: { lt: 10 } }) }),
    );
    expect(db.retailPromoCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedCount: { lt: 5 }, isActive: true }) }),
    );
    expect(db.retailPromotionMemberUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedCount: { lt: 2 } }) }),
    );
    // budget 10, ต้องการ 1 → issuedQty ต้อง ≤ 9 ก่อนบวก
    expect(db.retailPromotionGift.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ issuedQty: { lte: 9 } }) }),
    );
    expect(db.retailPromotionRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        saleId: 's1',
        guestId: 'g1',
        contactId: 'ct1',
        discountAmount: 20,
        giftCost: 40,
      }),
    });
  });

  it('auto promotion for a walk-in: no code counter, no member counter, nullable columns', async () => {
    const { db, service } = setup();
    await record(db, service, [applied({ code: null, autoApplied: true, discount: 0 })], null);
    expect(db.retailPromoCode.updateMany).not.toHaveBeenCalled();
    expect(db.retailPromotionMemberUsage.upsert).not.toHaveBeenCalled();
    expect(db.retailPromotionRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ promoCodeId: null, code: null, guestId: null, contactId: null }),
    });
  });

  it('writes one redemption per promotion in the bill', async () => {
    const { db, service } = setup();
    await record(db, service, [applied(), applied({ promotion: { ...applied().promotion, id: 'p2' }, code: null })]);
    expect(db.retailPromotionRedemption.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['retailPromotion', 'PROMO_SOLD_OUT'],
    ['retailPromoCode', 'PROMO_CODE_USED_UP'],
    ['retailPromotionMemberUsage', 'PROMO_MEMBER_LIMIT'],
    ['retailPromotionGift', 'PROMO_GIFT_SHORTAGE'],
  ] as const)('a lost race on %s aborts the sale with %s', async (model, expected) => {
    const { db, service } = setup();
    db[model].updateMany.mockResolvedValue({ count: 0 });
    expect(await errorCode(record(db, service))).toBe(expected);
    expect(db.retailPromotionRedemption.create).not.toHaveBeenCalled();
  });
});

describe('RetailPromotionCheckoutService.reverseRedemptionsWithin', () => {
  it('reverses every applied redemption and returns gift budget per promotion', async () => {
    const { db, service } = setup();
    db.retailPromotionRedemption.findMany.mockResolvedValue([
      { id: 'r1', promotionId: 'code-p', promoCodeId: 'c1', guestId: 'g1' },
      { id: 'r2', promotionId: 'auto1', promoCodeId: null, guestId: null },
    ]);
    const out = await service.reverseRedemptionsWithin(db as never, {
      tenantId: TENANT,
      saleId: 's1',
      giftLines: [
        { itemId: 'tote', quantity: 1, promotionId: 'auto1' },
        { itemId: 'mug', quantity: 2, promotionId: 'code-p' },
      ],
    });
    expect(out.map((r) => r.promotionId)).toEqual(['code-p', 'auto1']);
    expect(db.retailPromoCode.updateMany).toHaveBeenCalledTimes(1);
    expect(db.retailPromotionMemberUsage.updateMany).toHaveBeenCalledTimes(1);
    expect(db.retailPromotionGift.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, promotionId: 'auto1', itemId: 'tote', issuedQty: { gte: 1 } },
      data: { issuedQty: { decrement: 1 } },
    });
    expect(db.retailPromotionGift.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, promotionId: 'code-p', itemId: 'mug', issuedQty: { gte: 2 } },
      data: { issuedQty: { decrement: 2 } },
    });
  });

  it('a redemption already flipped by a concurrent void is skipped', async () => {
    const { db, service } = setup();
    db.retailPromotionRedemption.findMany.mockResolvedValue([
      { id: 'r1', promotionId: 'code-p', promoCodeId: 'c1', guestId: 'g1' },
    ]);
    db.retailPromotionRedemption.updateMany.mockResolvedValue({ count: 0 });
    expect(
      await service.reverseRedemptionsWithin(db as never, { tenantId: TENANT, saleId: 's1', giftLines: [] }),
    ).toEqual([]);
    expect(db.retailPromotion.updateMany).not.toHaveBeenCalled();
  });
});
