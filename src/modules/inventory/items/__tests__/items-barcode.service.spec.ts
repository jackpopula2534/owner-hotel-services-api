/**
 * ยิงบาร์โค้ดที่หน้าขาย — ต้องได้ของชิ้นเดียว หรือไม่ได้เลย
 *
 * บั๊กที่เทสต์ชุดนี้กันไว้: ถ้าไปยืม `searchItems` มาใช้ (contains name/sku + เรียงตามชื่อ)
 * การยิงบาร์โค้ดจะได้รายการหลายตัวแล้วหน้าขายหยิบตัวแรกเข้าตะกร้าเอง
 * แขกโดนคิดเงินของผิดตัวโดยไม่มีใครอ่านซ้ำ เพราะการยิงบาร์โค้ดไม่มีขั้นตอน "เลือก"
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ItemsService } from '../items.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('ItemsService — ยิงบาร์โค้ด', () => {
  let service: ItemsService;

  const prisma = {
    inventoryItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    itemCategory: { findFirst: jest.fn() },
  };

  const tenantId = 'tenant-1';

  const ROW = {
    id: 'item-water',
    sku: 'SKU-W',
    name: 'น้ำดื่ม 600ml',
    unit: 'BOTTLE',
    barcode: '8850001000011',
    imageUrl: null,
    sellingPrice: '20.00',
    category: { id: 'cat-1', name: 'เครื่องดื่ม' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ItemsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ItemsService>(ItemsService);
  });

  describe('findByBarcode', () => {
    it('เทียบบาร์โค้ดเท่ากันเป๊ะ ไม่ใช่ contains และผูก tenant เสมอ', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([ROW]);

      await service.findByBarcode(tenantId, { code: '8850001000011' });

      const args = prisma.inventoryItem.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({
        tenantId,
        deletedAt: null,
        isActive: true,
        barcode: '8850001000011',
      });
      // ขอมาสองแถวเพื่อ "รู้ว่าซ้ำ" ไม่ใช่ take:1 ที่เลือกให้เองเงียบ ๆ
      expect(args.take).toBe(2);
    });

    it('ตัดช่องว่างหัวท้ายที่เครื่องยิงชอบแถมมาให้', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([ROW]);

      await service.findByBarcode(tenantId, { code: '  8850001000011  ' });

      expect(prisma.inventoryItem.findMany.mock.calls[0][0].where.barcode).toBe('8850001000011');
    });

    it('คืนราคาขายเป็นตัวเลข ไม่ใช่ Decimal ที่หน้าจอเอาไปบวกไม่ได้', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([ROW]);

      const result = await service.findByBarcode(tenantId, { code: '8850001000011' });

      expect(result.sellingPrice).toBe(20);
      expect(result).toMatchObject({ id: 'item-water', sku: 'SKU-W', name: 'น้ำดื่ม 600ml' });
    });

    it('ยังไม่ตั้งราคาขาย = คืน null ให้หน้าจอห้ามขาย ไม่ใช่แปลงเป็น 0', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([{ ...ROW, sellingPrice: null }]);

      const result = await service.findByBarcode(tenantId, { code: '8850001000011' });

      expect(result.sellingPrice).toBeNull();
    });

    it('ระบุคลังมาด้วย = คืนยอดที่หยิบได้จริง (คงเหลือ − ที่ถูกกันไว้)', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([
        { ...ROW, warehouseStocks: [{ quantity: 10, reservedQty: 3 }] },
      ]);

      const result = await service.findByBarcode(tenantId, {
        code: '8850001000011',
        warehouseId: 'wh-1',
      });

      expect(result.stockQuantity).toBe(7);
      const args = prisma.inventoryItem.findMany.mock.calls[0][0];
      expect(args.select.warehouseStocks.where).toEqual({ warehouseId: 'wh-1' });
    });

    it('ไม่ระบุคลัง = ไม่ไป join สต๊อก และคืน stockQuantity เป็น null ไม่ใช่ 0', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([ROW]);

      const result = await service.findByBarcode(tenantId, { code: '8850001000011' });

      expect(result.stockQuantity).toBeNull();
      expect(prisma.inventoryItem.findMany.mock.calls[0][0].select.warehouseStocks).toBeUndefined();
    });

    it('ไม่เจอ = 404 พร้อมบาร์โค้ดที่ยิงไป ไม่ใช่ตอบของว่าง ๆ', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);

      await expect(service.findByBarcode(tenantId, { code: '999' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('บาร์โค้ดเดียวเจอสองรายการ = หยุด ไม่ใช่เลือกตัวแรกให้เอง', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([ROW, { ...ROW, id: 'item-2' }]);

      await expect(
        service.findByBarcode(tenantId, { code: '8850001000011' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('กันบาร์โค้ดซ้ำตั้งแต่ตอนบันทึกสินค้า', () => {
    it('สร้างสินค้าด้วยบาร์โค้ดที่มีคนใช้แล้ว = 409 บอกว่าไปชนกับตัวไหน', async () => {
      prisma.inventoryItem.findFirst
        .mockResolvedValueOnce(null) // sku ยังว่าง
        .mockResolvedValueOnce({ sku: 'SKU-W', name: 'น้ำดื่ม 600ml' }); // บาร์โค้ดชน

      await expect(
        service.create({ sku: 'SKU-NEW', name: 'ของใหม่', barcode: '8850001000011' } as never, tenantId),
      ).rejects.toThrow(/8850001000011/);

      expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
    });

    it('ไม่ใส่บาร์โค้ดมาเลย = ไม่ต้องไปเช็คซ้ำ (null ซ้ำกันได้ตามธรรมชาติ)', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);
      prisma.inventoryItem.create.mockResolvedValue({ id: 'new' });

      await service.create({ sku: 'SKU-NEW', name: 'ของใหม่' } as never, tenantId);

      // เรียกครั้งเดียวคือเช็ค sku เท่านั้น
      expect(prisma.inventoryItem.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.inventoryItem.create).toHaveBeenCalled();
    });
  });
});
