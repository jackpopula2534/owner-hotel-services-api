import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RetailSalesService } from '../retail-sales.service';
import { PrismaService } from '@/prisma/prisma.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const WH = 'wh-1';

/**
 * Build a fresh mock Prisma. `$transaction` runs the callback against the same
 * mock object so all tx.* calls are observable on the returned mock.
 */
function buildPrisma() {
  const mock: any = {
    warehouse: { findFirst: jest.fn() },
    inventoryItem: { findMany: jest.fn() },
    warehouseStock: { findFirst: jest.fn(), update: jest.fn() },
    inventoryLot: { findMany: jest.fn(), update: jest.fn() },
    stockMovement: { create: jest.fn() },
    documentSequence: { upsert: jest.fn() },
    retailSale: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };
  mock.$transaction = jest.fn((cb: any) => cb(mock));
  // Default happy stubs
  mock.warehouse.findFirst.mockResolvedValue({ id: WH, tenantId: TENANT });
  mock.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
  mock.warehouseStock.update.mockResolvedValue({});
  mock.stockMovement.create.mockResolvedValue({});
  mock.inventoryLot.update.mockResolvedValue({});
  // Echo the created sale back so toDetail can map it.
  mock.retailSale.create.mockImplementation(({ data }: any) => ({
    ...data,
    status: 'COMPLETED',
    createdAt: new Date(),
    soldAt: new Date(),
    items: data.items.createMany.data,
  }));
  return mock;
}

async function makeService(prisma: any): Promise<RetailSalesService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [RetailSalesService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(RetailSalesService);
}

describe('RetailSalesService', () => {
  describe('create', () => {
    it('deducts WarehouseStock, writes GOODS_ISSUE/RETAIL_SALE movement, computes totals', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
        { id: 'i2', tenantId: TENANT, sku: 'B', name: 'Water', unit: 'BOTTLE', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst
        .mockResolvedValueOnce({ id: 's1', quantity: 10, avgCost: 60 })
        .mockResolvedValueOnce({ id: 's2', quantity: 5, avgCost: 30 });

      const service = await makeService(prisma);
      const result = await service.create(
        {
          warehouseId: WH,
          paymentMethod: 'CASH' as any,
          lines: [
            { itemId: 'i1', quantity: 2, unitPrice: 100 },
            { itemId: 'i2', quantity: 1, unitPrice: 50 },
          ],
        },
        USER,
        TENANT,
      );

      // Receipt number
      expect(result.receiptNo).toBe('RCP-' + `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}` + '-0001');
      // Totals: subtotal 250, vat 7% = 17.5, grand 267.5
      expect(result.subtotal).toBe(250);
      expect(result.vatAmount).toBe(17.5);
      expect(result.grandTotal).toBe(267.5);
      // COGS: 2*60 + 1*30 = 150, profit = 250 - 150 = 100
      expect(result.costTotal).toBe(150);
      expect(result.profitTotal).toBe(100);
      // Two GOODS_ISSUE movements created with RETAIL_SALE reference
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      const mv = prisma.stockMovement.create.mock.calls[0][0].data;
      expect(mv.type).toBe('GOODS_ISSUE');
      expect(mv.referenceType).toBe('RETAIL_SALE');
      expect(mv.quantity).toBe(2);
      // Stock decremented (10 - 2 = 8)
      expect(prisma.warehouseStock.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ quantity: 8 }) }),
      );
      expect(result.items).toHaveLength(2);
    });

    it('consumes FEFO lots for a lot-tracked item (earliest expiry first)', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'M', name: 'Milk', unit: 'BOTTLE', isPerishable: true, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 10, avgCost: 20 });
      prisma.inventoryLot.findMany.mockResolvedValue([
        { id: 'lotA', remainingQty: 2, unitCost: 18, status: 'ACTIVE' },
        { id: 'lotB', remainingQty: 5, unitCost: 22, status: 'ACTIVE' },
      ]);

      const service = await makeService(prisma);
      await service.create(
        { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 3, unitPrice: 40 }] },
        USER,
        TENANT,
      );

      // lotA fully consumed (2) -> EXHAUSTED; lotB partially (1)
      expect(prisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lotA' }, data: expect.objectContaining({ remainingQty: 0, status: 'EXHAUSTED' }) }),
      );
      expect(prisma.inventoryLot.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'lotB' }, data: expect.objectContaining({ remainingQty: 4 }) }),
      );
      // One movement per consumed lot
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('throws when warehouse stock is insufficient', async () => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findMany.mockResolvedValue([
        { id: 'i1', tenantId: TENANT, sku: 'A', name: 'Cola', unit: 'CAN', isPerishable: false, requiresLotTracking: false },
      ]);
      prisma.warehouseStock.findFirst.mockResolvedValue({ id: 's1', quantity: 1, avgCost: 60 });

      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 5, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when ROOM_CHARGE lacks room number / guest name', async () => {
      const prisma = buildPrisma();
      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'ROOM_CHARGE' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when warehouse does not belong to tenant', async () => {
      const prisma = buildPrisma();
      prisma.warehouse.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);
      await expect(
        service.create(
          { warehouseId: WH, paymentMethod: 'CASH' as any, lines: [{ itemId: 'i1', quantity: 1, unitPrice: 100 }] },
          USER,
          TENANT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns paginated rows with range summary', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findMany.mockResolvedValue([
        {
          id: 'r1', receiptNo: 'RCP-202606-0001', warehouseId: WH, status: 'COMPLETED', paymentMethod: 'CASH',
          roomNumber: null, guestName: null, bookingId: null, subtotal: 250, discountTotal: 0, vatRate: 7,
          vatAmount: 17.5, grandTotal: 267.5, costTotal: 150, profitTotal: 100, notes: null, soldBy: USER,
          soldAt: new Date(), createdAt: new Date(), items: [],
        },
      ]);
      prisma.retailSale.count.mockResolvedValue(1);
      prisma.retailSale.aggregate.mockResolvedValue({ _sum: { grandTotal: 267.5, profitTotal: 100, costTotal: 150 } });

      const service = await makeService(prisma);
      const res = await service.findAll(TENANT, { page: 1, limit: 20 });
      expect(res.meta.total).toBe(1);
      expect(res.data).toHaveLength(1);
      expect(res.summary.totalSales).toBe(267.5);
      expect(res.summary.totalProfit).toBe(100);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      const prisma = buildPrisma();
      prisma.retailSale.findFirst.mockResolvedValue(null);
      const service = await makeService(prisma);
      await expect(service.findOne('nope', TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
