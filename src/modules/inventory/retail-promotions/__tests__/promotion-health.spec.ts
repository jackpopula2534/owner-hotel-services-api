import { RetailPromoDiscountType } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { assessPromotion, giftRuns, HealthGift, HealthPromotion, shouldAutoPause } from '../promotion-health';
import { RetailPromotionHealthService } from '../retail-promotion-health.service';
import { PrismaService } from '@/prisma/prisma.service';

const gift = (over: Partial<HealthGift> = {}): HealthGift => ({
  itemId: 'tote',
  name: 'ถุงผ้า',
  unit: 'ใบ',
  quantity: 1,
  budgetQty: null,
  issuedQty: 0,
  stockQty: 100,
  ...over,
});

const promo = (over: Partial<HealthPromotion> = {}): HealthPromotion => ({
  id: 'p1',
  name: 'ซื้อครบรับถุงผ้า',
  discountType: RetailPromoDiscountType.NONE,
  usageLimit: null,
  usedCount: 0,
  ...over,
});

describe('giftRuns', () => {
  it('ไม่มีงบ → จำกัดด้วยสต็อก และหารด้วยจำนวนต่อบิล', () => {
    expect(giftRuns(gift({ stockQty: 7, quantity: 2 }))).toEqual({ runs: 3, limitedBy: 'STOCK', remainingQty: 7 });
  });

  it('งบเหลือน้อยกว่าสต็อก → จำกัดด้วยงบ', () => {
    expect(giftRuns(gift({ budgetQty: 50, issuedQty: 45, stockQty: 30 }))).toEqual({
      runs: 5,
      limitedBy: 'BUDGET',
      remainingQty: 5,
    });
  });

  it('สต็อกติดลบ/ทศนิยม ไม่ทำให้นับเกิน', () => {
    expect(giftRuns(gift({ stockQty: -3 })).runs).toBe(0);
    expect(giftRuns(gift({ stockQty: 2.9 })).runs).toBe(2);
  });
});

describe('assessPromotion', () => {
  it('ของพอ → ไม่มีแจ้งเตือน', () => {
    expect(assessPromotion(promo(), [gift({ stockQty: 500 })])).toEqual([]);
  });

  it('สต็อกหมด → GIFT_OUT วิกฤต บอกให้โอนเข้าคลังของแถม', () => {
    const [a] = assessPromotion(promo(), [gift({ stockQty: 0 })]);
    expect(a).toMatchObject({ kind: 'GIFT_OUT', severity: 'critical', limitedBy: 'STOCK', remainingRuns: 0 });
    expect(a.message).toContain('โอนสต็อก');
  });

  it('งบหมดแต่สต็อกยังมี → GIFT_OUT บอกให้เพิ่มงบ', () => {
    const [a] = assessPromotion(promo(), [gift({ budgetQty: 20, issuedQty: 20 })]);
    expect(a).toMatchObject({ kind: 'GIFT_OUT', limitedBy: 'BUDGET' });
    expect(a.message).toContain('เพิ่มงบ');
  });

  it('เหลือแจกได้ ≤ 10 บิล → GIFT_LOW', () => {
    const [a] = assessPromotion(promo(), [gift({ stockQty: 10 })]);
    expect(a).toMatchObject({ kind: 'GIFT_LOW', severity: 'warning', remainingRuns: 10 });
  });

  it('งบเหลือ ≤ 20% แม้ยังแจกได้เกิน 10 บิล → GIFT_LOW', () => {
    const [a] = assessPromotion(promo(), [gift({ budgetQty: 100, issuedQty: 85, stockQty: 500 })]);
    expect(a).toMatchObject({ kind: 'GIFT_LOW', limitedBy: 'BUDGET', remainingRuns: 15 });
  });

  it('โควตาโปรเต็ม / ใกล้เต็ม', () => {
    expect(assessPromotion(promo({ usageLimit: 100, usedCount: 100 }), [])).toEqual([
      expect.objectContaining({ kind: 'USAGE_FULL', severity: 'critical' }),
    ]);
    expect(assessPromotion(promo({ usageLimit: 100, usedCount: 91 }), [])).toEqual([
      expect.objectContaining({ kind: 'USAGE_LOW', remainingRuns: 9 }),
    ]);
    expect(assessPromotion(promo({ usageLimit: 100, usedCount: 80 }), [])).toEqual([]);
  });

  it('โควตาเล็ก ๆ ใช้เกณฑ์ขั้นต่ำ 5 ครั้ง', () => {
    expect(assessPromotion(promo({ usageLimit: 20, usedCount: 15 }), [])).toEqual([
      expect.objectContaining({ kind: 'USAGE_LOW', remainingRuns: 5 }),
    ]);
  });
});

describe('shouldAutoPause', () => {
  it('โปรของแถมอย่างเดียว + ของแถมหมด → หยุด', () => {
    expect(shouldAutoPause(promo(), [gift({ stockQty: 0 })])).toContain('หยุดอัตโนมัติ');
  });

  it('โปรมีส่วนลด → ไม่หยุด (ลูกค้ายังเลือกรับเฉพาะส่วนลดได้)', () => {
    expect(shouldAutoPause(promo({ discountType: RetailPromoDiscountType.FIXED }), [gift({ stockQty: 0 })])).toBeNull();
  });

  it('ของแถมยังเหลือ หรือโปรไม่มีของแถม → ไม่หยุด', () => {
    expect(shouldAutoPause(promo(), [gift({ stockQty: 1 })])).toBeNull();
    expect(shouldAutoPause(promo(), [])).toBeNull();
  });
});

describe('RetailPromotionHealthService', () => {
  const PROMO_ROW = {
    id: 'p1',
    name: 'ซื้อครบรับถุงผ้า',
    status: 'ACTIVE',
    discountType: 'NONE',
    usageLimit: null,
    usedCount: 3,
    giftWarehouseId: 'wh-gift',
    autoPausedAt: null,
    pausedReason: null,
    gifts: [{ itemId: 'tote', quantity: 1, budgetQty: null, issuedQty: 3 }],
  };

  function buildPrisma(stockQty: number) {
    return {
      retailPromotion: {
        findFirst: jest.fn().mockResolvedValue(PROMO_ROW),
        findMany: jest.fn().mockResolvedValue([PROMO_ROW]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([{ id: 'tote', name: 'ถุงผ้า', unit: 'ใบ' }]) },
      warehouseStock: {
        findMany: jest.fn().mockResolvedValue([{ warehouseId: 'wh-gift', itemId: 'tote', quantity: stockQty }]),
      },
    };
  }

  async function makeService(prisma: unknown) {
    const moduleRef = await Test.createTestingModule({
      providers: [RetailPromotionHealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return moduleRef.get(RetailPromotionHealthService);
  }

  it('ของแถมชิ้นสุดท้ายถูกแจก → หยุดแบบมีเงื่อนไข ACTIVE พร้อมเหตุผล', async () => {
    const prisma = buildPrisma(0);
    const service = await makeService(prisma);
    await expect(service.autoPauseIfExhaustedWithin(prisma as never, 't1', 'p1')).resolves.toBe(true);
    expect(prisma.retailPromotion.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: 't1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'PAUSED', autoPausedAt: expect.any(Date), pausedReason: expect.stringContaining('ถุงผ้า') }),
    });
  });

  it('ยังมีของ → ไม่แตะสถานะ', async () => {
    const prisma = buildPrisma(4);
    const service = await makeService(prisma);
    await expect(service.autoPauseIfExhaustedWithin(prisma as never, 't1', 'p1')).resolves.toBe(false);
    expect(prisma.retailPromotion.updateMany).not.toHaveBeenCalled();
  });

  it('สต็อกคลังของแถมอ่านผ่านคลังของ tenant เท่านั้น', async () => {
    const prisma = buildPrisma(2);
    const service = await makeService(prisma);
    const { alerts } = await service.alerts('t1');
    expect(prisma.warehouseStock.findMany.mock.calls[0][0].where.warehouse).toEqual({ tenantId: 't1' });
    expect(alerts).toEqual([expect.objectContaining({ kind: 'GIFT_LOW', remainingRuns: 2 })]);
  });

  it('gift-stock: รวมของในคลังของแถม + โปรที่ผูก + ของที่โปรผูกแต่ยังไม่เคยเข้าคลัง', async () => {
    const prisma = {
      ...buildPrisma(5),
      warehouse: {
        findMany: jest.fn().mockResolvedValue([{ id: 'wh-gift', name: 'คลังของแถม', code: 'WH-GIFT', isActive: true }]),
      },
    };
    prisma.warehouseStock.findMany
      // ครั้งแรก: สต็อกทั้งคลัง (มี item ของ include)
      .mockResolvedValueOnce([
        { warehouseId: 'wh-gift', itemId: 'tote', quantity: 5, avgCost: 45, totalValue: 225, item: { name: 'ถุงผ้า', sku: 'TOTE', unit: 'ใบ' } },
      ])
      // ครั้งที่สอง: loadGifts
      .mockResolvedValueOnce([{ warehouseId: 'wh-gift', itemId: 'tote', quantity: 5 }]);
    prisma.retailPromotion.findMany.mockResolvedValue([
      PROMO_ROW,
      { ...PROMO_ROW, id: 'p2', name: 'แถมพวงกุญแจ', gifts: [{ itemId: 'key', quantity: 2, budgetQty: null, issuedQty: 0 }] },
    ]);
    prisma.inventoryItem.findMany.mockResolvedValue([
      { id: 'tote', name: 'ถุงผ้า', unit: 'ใบ' },
      { id: 'key', name: 'พวงกุญแจ', unit: 'ชิ้น' },
    ]);
    const service = await makeService(prisma);
    const [wh] = await service.giftStock('t1');

    expect(prisma.warehouse.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', type: 'PROMOTION' });
    expect(wh.items).toEqual([
      expect.objectContaining({ itemId: 'tote', quantity: 5, promotions: [expect.objectContaining({ promotionId: 'p1', runs: 5 })] }),
      expect.objectContaining({ itemId: 'key', quantity: 0, promotions: [expect.objectContaining({ promotionId: 'p2', runs: 0 })] }),
    ]);
  });

  it('gift-stock: ไม่มีคลังของแถม → []', async () => {
    const prisma = { ...buildPrisma(0), warehouse: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = await makeService(prisma);
    await expect(service.giftStock('t1')).resolves.toEqual([]);
  });
});
