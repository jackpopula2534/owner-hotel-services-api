import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RevenueSourceType } from '@prisma/client';
import { RetailSaleVoidService } from '../retail-sale-void.service';
import { RetailPromotionsService } from '../../retail-promotions/retail-promotions.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FolioPostingService } from '@/modules/accounts-receivable/folio-posting/folio-posting.service';
import { RevenuePostingService } from '@/modules/revenue/revenue-posting.service';
import {
  buildRevenuePostingStub,
  type RevenuePostingStub,
} from '@/modules/revenue/__tests__/revenue-posting.stub';

const TENANT = 'tenant-1';
const USER = 'manager-1';
const SALE_ID = 'sale-1';
const SHOP_WH = 'wh-shop';
const GIFT_WH = 'wh-gift';

const SALE = {
  id: SALE_ID,
  tenantId: TENANT,
  receiptNo: 'RCP-202610-0007',
  status: 'COMPLETED',
  items: [
    { itemId: 'item-water', quantity: 3, isGift: false },
    { itemId: 'item-tote', quantity: 1, isGift: true },
  ],
};

/** การตัดสต็อกของใบนี้: น้ำ 3 ขวดจาก 2 ล็อตคนละต้นทุน + ถุงผ้า 1 ใบจากคลังของแถม */
const ISSUES = [
  { warehouseId: SHOP_WH, itemId: 'item-water', quantity: 2, unitCost: 5, referenceType: 'RETAIL_SALE', lotId: 'lot-a' },
  { warehouseId: SHOP_WH, itemId: 'item-water', quantity: 1, unitCost: 8, referenceType: 'RETAIL_SALE', lotId: 'lot-b' },
  { warehouseId: GIFT_WH, itemId: 'item-tote', quantity: 1, unitCost: 40, referenceType: 'PROMO_GIFT', lotId: null },
];

function buildPrisma() {
  const mock: any = {
    retailSale: { findFirst: jest.fn(), updateMany: jest.fn() },
    stockMovement: { findMany: jest.fn(), create: jest.fn() },
    inventoryLot: { findFirst: jest.fn(), update: jest.fn() },
    warehouseStock: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    retailPromotionRedemption: { findFirst: jest.fn(), updateMany: jest.fn() },
    retailPromotion: { updateMany: jest.fn() },
    retailPromoCode: { updateMany: jest.fn() },
    retailPromotionMemberUsage: { updateMany: jest.fn() },
    retailPromotionGift: { updateMany: jest.fn() },
  };
  mock.$transaction = jest.fn((cb: any) => cb(mock));
  mock.retailSale.findFirst.mockResolvedValue(SALE);
  mock.retailSale.updateMany.mockResolvedValue({ count: 1 });
  mock.stockMovement.findMany.mockResolvedValue(ISSUES);
  mock.stockMovement.create.mockResolvedValue({});
  mock.inventoryLot.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: where.id, status: where.id === 'lot-b' ? 'EXHAUSTED' : 'ACTIVE' }),
  );
  mock.inventoryLot.update.mockResolvedValue({});
  mock.warehouseStock.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(
      where.warehouseId === SHOP_WH
        ? { id: 'ws-water', quantity: 7, avgCost: 6 }
        : { id: 'ws-tote', quantity: 0, avgCost: 40 },
    ),
  );
  mock.warehouseStock.update.mockResolvedValue({});
  mock.retailPromotionRedemption.findFirst.mockResolvedValue(null);
  mock.retailPromotionRedemption.updateMany.mockResolvedValue({ count: 1 });
  for (const model of ['retailPromotion', 'retailPromoCode', 'retailPromotionMemberUsage', 'retailPromotionGift']) {
    mock[model].updateMany.mockResolvedValue({ count: 1 });
  }
  return mock;
}

function buildFolioPosting() {
  const real = FolioPostingService.prototype as unknown as Record<string, unknown>;
  expect(typeof real.reverseChargeWithin).toBe('function');
  return { reverseChargeWithin: jest.fn().mockResolvedValue(null) };
}

async function makeService(
  prisma: any,
  folio = buildFolioPosting(),
  revenue: RevenuePostingStub = buildRevenuePostingStub(),
) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      RetailSaleVoidService,
      RetailPromotionsService,
      { provide: PrismaService, useValue: prisma },
      { provide: FolioPostingService, useValue: folio },
      { provide: RevenuePostingService, useValue: revenue },
    ],
  }).compile();
  return { service: moduleRef.get(RetailSaleVoidService), folio, revenue };
}

describe('RetailSaleVoidService', () => {
  it('ต้องมีเหตุผล', async () => {
    const { service } = await makeService(buildPrisma());
    await expect(service.void(SALE_ID, TENANT, USER, '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ไม่พบใบ (หรือเป็นของ tenant อื่น) = 404', async () => {
    const prisma = buildPrisma();
    prisma.retailSale.findFirst.mockResolvedValue(null);
    const { service } = await makeService(prisma);
    await expect(service.void(SALE_ID, TENANT, USER, 'ขายผิด')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.retailSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SALE_ID, tenantId: TENANT } }),
    );
  });

  it('ยกเลิกซ้ำ = ปฏิเสธ และไม่คืนของซ้ำ', async () => {
    const prisma = buildPrisma();
    prisma.retailSale.findFirst.mockResolvedValue({ ...SALE, status: 'VOIDED' });
    const { service } = await makeService(prisma);
    await expect(service.void(SALE_ID, TENANT, USER, 'ขายผิด')).rejects.toMatchObject({
      response: { code: 'SALE_ALREADY_VOIDED' },
    });
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it('กดยกเลิกพร้อมกันสองคน = คนที่สองแพ้ที่เงื่อนไข status และไม่คืนของ', async () => {
    const prisma = buildPrisma();
    prisma.retailSale.updateMany.mockResolvedValue({ count: 0 });
    const { service } = await makeService(prisma);
    await expect(service.void(SALE_ID, TENANT, USER, 'ขายผิด')).rejects.toMatchObject({
      response: { code: 'SALE_ALREADY_VOIDED' },
    });
    expect(prisma.retailSale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SALE_ID, tenantId: TENANT, status: 'COMPLETED' } }),
    );
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });

  it('คืนของทุกการเคลื่อนไหวกลับคลังเดิม ล็อตเดิม ต้นทุนเดิม', async () => {
    const prisma = buildPrisma();
    const { service } = await makeService(prisma);
    const result = await service.void(SALE_ID, TENANT, USER, 'ลูกค้าขอยกเลิก');

    expect(result).toMatchObject({ status: 'VOIDED', restockedQty: 4, voidReason: 'ลูกค้าขอยกเลิก' });
    const backIn = prisma.stockMovement.create.mock.calls.map(([arg]: any) => arg.data);
    expect(backIn).toEqual([
      expect.objectContaining({ type: 'ADJUSTMENT_IN', warehouseId: SHOP_WH, quantity: 2, unitCost: 5, lotId: 'lot-a', referenceType: 'RETAIL_SALE_VOID', referenceId: SALE_ID }),
      expect.objectContaining({ type: 'ADJUSTMENT_IN', warehouseId: SHOP_WH, quantity: 1, unitCost: 8, lotId: 'lot-b', referenceType: 'RETAIL_SALE_VOID' }),
      expect.objectContaining({ type: 'ADJUSTMENT_IN', warehouseId: GIFT_WH, quantity: 1, unitCost: 40, lotId: null, referenceType: 'PROMO_GIFT_VOID' }),
    ]);

    // ล็อตที่หมดเพราะใบนี้กลับมา ACTIVE, ล็อตปกติแค่เพิ่มจำนวน
    expect(prisma.inventoryLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-b' },
      data: { remainingQty: { increment: 1 }, status: 'ACTIVE' },
    });
    expect(prisma.inventoryLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-a' },
      data: { remainingQty: { increment: 2 } },
    });

    // น้ำ: 7 ชิ้น @6 = 42 + คืน (2@5 + 1@8 = 18) → 10 ชิ้น มูลค่า 60 avg 6
    expect(prisma.warehouseStock.update).toHaveBeenCalledWith({
      where: { id: 'ws-water' },
      data: expect.objectContaining({ quantity: 10, totalValue: 60, avgCost: 6 }),
    });
    expect(prisma.warehouseStock.update).toHaveBeenCalledWith({
      where: { id: 'ws-tote' },
      data: expect.objectContaining({ quantity: 1, totalValue: 40, avgCost: 40 }),
    });
  });

  it('ยกเลิกรายได้ในสมุดกลาง และกลับรายการโฟลิโอใน transaction เดียวกัน', async () => {
    const prisma = buildPrisma();
    const { service, folio, revenue } = await makeService(prisma);
    await service.void(SALE_ID, TENANT, USER, 'ขายผิด');

    expect(revenue.voidWithin).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ tenantId: TENANT, sourceType: RevenueSourceType.RETAIL_SALE, sourceId: SALE_ID, voidedBy: USER, reason: 'ขายผิด' }),
    );
    expect(folio.reverseChargeWithin).toHaveBeenCalledWith(prisma, {
      tenantId: TENANT,
      sourceType: 'RETAIL_SALE',
      sourceId: SALE_ID,
      reversedBy: USER,
    });
  });

  it('โฟลิโอปิดแล้ว = ยกเลิกไม่ได้ทั้งใบ (error ทะลุออกมา ไม่กลืน)', async () => {
    const prisma = buildPrisma();
    const folio = buildFolioPosting();
    folio.reverseChargeWithin.mockRejectedValue(
      new BadRequestException({ code: 'FOLIO_NOT_OPEN', message: 'ปิดแล้ว' }),
    );
    const { service, revenue } = await makeService(prisma, folio);
    await expect(service.void(SALE_ID, TENANT, USER, 'ขายผิด')).rejects.toMatchObject({
      response: { code: 'FOLIO_NOT_OPEN' },
    });
    expect(revenue.voidWithin).not.toHaveBeenCalled();
  });

  it('บิลที่ใช้โค้ด: คืนโควตาโปร/โค้ด/สมาชิก และงบของแถมตามบรรทัดของแถมจริง', async () => {
    const prisma = buildPrisma();
    prisma.retailPromotionRedemption.findFirst.mockResolvedValue({
      id: 'red-1',
      promotionId: 'promo-1',
      promoCodeId: 'code-1',
      guestId: 'guest-1',
    });
    const { service } = await makeService(prisma);
    const result = await service.void(SALE_ID, TENANT, USER, 'ขายผิด');

    expect(result.promoReversed).toBe(true);
    expect(prisma.retailPromotionRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'red-1', status: 'APPLIED' },
      data: expect.objectContaining({ status: 'REVERSED' }),
    });
    expect(prisma.retailPromotion.updateMany).toHaveBeenCalledWith({
      where: { id: 'promo-1', tenantId: TENANT, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    expect(prisma.retailPromoCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'code-1', tenantId: TENANT, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    expect(prisma.retailPromotionMemberUsage.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, promotionId: 'promo-1', guestId: 'guest-1', usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    expect(prisma.retailPromotionGift.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, promotionId: 'promo-1', itemId: 'item-tote', issuedQty: { gte: 1 } },
      data: { issuedQty: { decrement: 1 } },
    });
  });

  it('บิลไม่ได้ใช้โค้ด = ไม่แตะตัวนับโปร', async () => {
    const prisma = buildPrisma();
    const { service } = await makeService(prisma);
    const result = await service.void(SALE_ID, TENANT, USER, 'ขายผิด');
    expect(result.promoReversed).toBe(false);
    expect(prisma.retailPromotion.updateMany).not.toHaveBeenCalled();
  });
});
