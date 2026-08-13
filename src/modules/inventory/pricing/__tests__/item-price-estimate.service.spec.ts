/**
 * ราคาประมาณการต้องมาจากหลักฐาน ไม่ใช่การเดา.
 *
 * A purchase requisition raised by the kitchen has no price typed into it, and
 * the estimate this service produces is what an approver ends up weighing. So
 * the order of preference matters, and "no evidence" has to mean no number at
 * all rather than a quiet zero.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ItemPriceEstimateService } from '../item-price-estimate.service';

const prisma = {
  itemSupplier: { findMany: jest.fn() },
  purchaseOrderItem: { groupBy: jest.fn(), findMany: jest.fn() },
  warehouseStock: { groupBy: jest.fn() },
};

const TENANT = 'tenant-1';

describe('ItemPriceEstimateService', () => {
  let service: ItemPriceEstimateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.itemSupplier.findMany.mockResolvedValue([]);
    prisma.purchaseOrderItem.groupBy.mockResolvedValue([]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([]);
    prisma.warehouseStock.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemPriceEstimateService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ItemPriceEstimateService);
  });

  it('ใช้ราคาจากผู้ขายหลักก่อนเป็นอันดับแรก', async () => {
    prisma.itemSupplier.findMany.mockResolvedValue([
      { itemId: 'i-1', supplierId: 's-main', unitPrice: 45, isPreferred: true },
      { itemId: 'i-1', supplierId: 's-other', unitPrice: 30, isPreferred: false },
    ]);

    const result = await service.estimateMany(TENANT, ['i-1']);

    // Cheaper is not better here — the preferred supplier is who we actually buy from.
    expect(result.get('i-1')).toEqual({
      unitPrice: 45,
      source: 'SUPPLIER_PREFERRED',
      supplierId: 's-main',
    });
    // Already answered, so the fallbacks are never queried.
    expect(prisma.purchaseOrderItem.groupBy).not.toHaveBeenCalled();
  });

  it('ไม่มีผู้ขายหลัก ใช้ราคาที่ถูกที่สุดจากรายการราคาผู้ขาย', async () => {
    prisma.itemSupplier.findMany.mockResolvedValue([
      { itemId: 'i-1', supplierId: 's-cheap', unitPrice: 30, isPreferred: false },
      { itemId: 'i-1', supplierId: 's-dear', unitPrice: 55, isPreferred: false },
    ]);

    const result = await service.estimateMany(TENANT, ['i-1']);

    expect(result.get('i-1')).toEqual({
      unitPrice: 30,
      source: 'SUPPLIER',
      supplierId: 's-cheap',
    });
  });

  it('ไม่มีผู้ขายเลย ใช้ราคาจากใบสั่งซื้อล่าสุด', async () => {
    prisma.purchaseOrderItem.groupBy.mockResolvedValue([
      { itemId: 'i-1', _max: { createdAt: new Date('2026-07-01T00:00:00.000Z') } },
    ]);
    prisma.purchaseOrderItem.findMany.mockResolvedValue([{ itemId: 'i-1', unitPrice: 62.5 }]);

    const result = await service.estimateMany(TENANT, ['i-1']);

    expect(result.get('i-1')).toEqual({
      unitPrice: 62.5,
      source: 'LAST_PURCHASE',
      supplierId: null,
    });
    // The second query asks for exactly the newest row per item, not the history.
    expect(prisma.purchaseOrderItem.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ itemId: 'i-1', createdAt: new Date('2026-07-01T00:00:00.000Z') }],
      },
      select: { itemId: true, unitPrice: true },
    });
  });

  it('ใบสั่งซื้อที่ยกเลิกไม่นับเป็นราคาอ้างอิง', async () => {
    await service.estimateMany(TENANT, ['i-1']);

    expect(prisma.purchaseOrderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchaseOrder: { tenantId: TENANT, status: { not: 'CANCELLED' } },
        }),
      }),
    );
  });

  it('เหลือทางสุดท้าย ใช้ต้นทุนเฉลี่ยถ่วงน้ำหนักของสต็อกที่มีอยู่', async () => {
    // 10 @ 20 in one warehouse and 90 @ 10 in another averages to 11, not 15.
    prisma.warehouseStock.groupBy.mockResolvedValue([
      { itemId: 'i-1', _sum: { quantity: 100, totalValue: 1100 } },
    ]);

    const result = await service.estimateMany(TENANT, ['i-1']);

    expect(result.get('i-1')).toEqual({
      unitPrice: 11,
      source: 'STOCK_AVG',
      supplierId: null,
    });
  });

  it('ไม่มีหลักฐานราคาเลย ต้องไม่คืนค่า 0 แต่ต้องไม่มีรายการนั้นเลย', async () => {
    const result = await service.estimateMany(TENANT, ['i-unknown']);

    // Zero would print as "free" on every screen that totals the requisition.
    expect(result.has('i-unknown')).toBe(false);
  });

  it('สต็อกที่มีของแต่มูลค่าเป็น 0 ไม่ใช่ราคาอ้างอิง', async () => {
    prisma.warehouseStock.groupBy.mockResolvedValue([
      { itemId: 'i-1', _sum: { quantity: 40, totalValue: 0 } },
    ]);

    const result = await service.estimateMany(TENANT, ['i-1']);

    expect(result.has('i-1')).toBe(false);
  });

  it('หลายรายการพร้อมกัน ยิง query ชุดเดียวไม่ใช่ต่อรายการ', async () => {
    prisma.itemSupplier.findMany.mockResolvedValue([
      { itemId: 'i-1', supplierId: 's-1', unitPrice: 10, isPreferred: true },
    ]);
    prisma.warehouseStock.groupBy.mockResolvedValue([
      { itemId: 'i-2', _sum: { quantity: 5, totalValue: 250 } },
    ]);

    const result = await service.estimateMany(TENANT, ['i-1', 'i-2', 'i-1']);

    expect(result.get('i-1')?.unitPrice).toBe(10);
    expect(result.get('i-2')?.unitPrice).toBe(50);
    expect(prisma.itemSupplier.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.warehouseStock.groupBy).toHaveBeenCalledTimes(1);
    // The duplicate id is asked for once.
    expect(prisma.itemSupplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ itemId: { in: ['i-1', 'i-2'] } }),
      }),
    );
  });

  it('รายการที่ได้ราคาแล้ว ไม่ถูกถามซ้ำในขั้นถัดไป', async () => {
    prisma.itemSupplier.findMany.mockResolvedValue([
      { itemId: 'i-1', supplierId: 's-1', unitPrice: 10, isPreferred: true },
    ]);

    await service.estimateMany(TENANT, ['i-1', 'i-2']);

    expect(prisma.purchaseOrderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ itemId: { in: ['i-2'] } }),
      }),
    );
  });

  it('ไม่มีรายการเข้ามา ก็ไม่ต้องแตะฐานข้อมูล', async () => {
    const result = await service.estimateMany(TENANT, []);

    expect(result.size).toBe(0);
    expect(prisma.itemSupplier.findMany).not.toHaveBeenCalled();
  });
});
