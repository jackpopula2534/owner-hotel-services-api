import { Test, TestingModule } from '@nestjs/testing';
import { ProcurementStockService } from '../procurement-stock.service';
import { PrismaService } from '@/prisma/prisma.service';
import { withPrismaFallback } from '@/common/test';
import { StockBalanceFilter } from '../dto/query-balance.dto';
import { LotExpiryFilter } from '../dto/query-expiring.dto';

/**
 * Sprint 3 — unit tests for the procurement-side stock report.
 *
 * The service does its classification (LOW / OVERSTOCK / OUT_OF_STOCK / OK)
 * in memory because Prisma can't compare two columns on the same row, so
 * the tests focus heavily on those classification rules — that's where
 * regressions would actually hurt downstream UX.
 */
describe('ProcurementStockService', () => {
  let service: ProcurementStockService;

  const tenantId = 'tenant-001';

  // Helper — build a `WarehouseStock` row in the shape findMany returns.
  const stock = (
    overrides: Partial<{
      warehouseId: string;
      itemId: string;
      quantity: number;
      avgCost: number;
      totalValue: number;
      sku: string;
      name: string;
      reorderPoint: number;
      minStock: number;
      maxStock: number | null;
      isPerishable: boolean;
      categoryId: string | null;
      itemSuppliers: any[];
    }> = {},
  ) => ({
    warehouseId: overrides.warehouseId ?? 'wh-1',
    itemId: overrides.itemId ?? 'item-1',
    quantity: overrides.quantity ?? 100,
    avgCost: overrides.avgCost ?? 10,
    totalValue: overrides.totalValue ?? 1000,
    warehouse: { id: overrides.warehouseId ?? 'wh-1', name: 'Main' },
    item: {
      id: overrides.itemId ?? 'item-1',
      sku: overrides.sku ?? 'SKU-001',
      name: overrides.name ?? 'Item One',
      unit: 'PIECE',
      reorderPoint: overrides.reorderPoint ?? 0,
      reorderQty: 50,
      minStock: overrides.minStock ?? 0,
      maxStock: overrides.maxStock ?? null,
      isPerishable: overrides.isPerishable ?? false,
      categoryId: overrides.categoryId ?? null,
      category: null,
      itemSuppliers: overrides.itemSuppliers ?? [],
    },
  });

  const mockPrisma = withPrismaFallback({
    warehouseStock: {
      findMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalValue: 0 } }),
    },
    purchaseOrderItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryLot: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [ProcurementStockService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(ProcurementStockService);
  });

  describe('classification rules', () => {
    it('classifies quantity=0 as OUT_OF_STOCK regardless of reorder point', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 0, reorderPoint: 50 }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('OUT_OF_STOCK');
      expect(result.meta.breakdown.OUT_OF_STOCK).toBe(1);
    });

    it('classifies quantity below reorderPoint as LOW', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 30, reorderPoint: 50 }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('LOW');
      expect(result.data[0].deficit).toBe(20); // 50 - 30
    });

    it('falls back to minStock when reorderPoint is 0', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 5, reorderPoint: 0, minStock: 10 }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('LOW');
      expect(result.data[0].deficit).toBe(5);
    });

    it('classifies quantity above maxStock as OVERSTOCK with excess amount', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 880, reorderPoint: 100, maxStock: 400 }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('OVERSTOCK');
      expect(result.data[0].excess).toBe(480); // 880 - 400
    });

    it('classifies normal quantity as OK', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 200, reorderPoint: 50, maxStock: 500 }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('OK');
      expect(result.data[0].deficit).toBe(0);
      expect(result.data[0].excess).toBe(0);
    });

    it('skips OVERSTOCK classification when maxStock is null', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ quantity: 99999, reorderPoint: 50, maxStock: null }),
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].status).toBe('OK');
    });
  });

  describe('filter + sort', () => {
    beforeEach(() => {
      // Mixed dataset: 1 OUT, 1 LOW (smaller deficit), 1 LOW (bigger deficit), 1 OK
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ itemId: 'a', quantity: 200, reorderPoint: 100, name: 'Item A' }), // OK
        stock({ itemId: 'b', quantity: 30, reorderPoint: 100, name: 'Item B' }), // LOW deficit 70
        stock({ itemId: 'c', quantity: 10, reorderPoint: 100, name: 'Item C' }), // LOW deficit 90
        stock({ itemId: 'd', quantity: 0, reorderPoint: 50, name: 'Item D' }), // OUT
      ]);
    });

    it('filter=LOW returns only LOW rows', async () => {
      const result = await service.findBalance(tenantId, {
        filter: StockBalanceFilter.LOW,
      });
      expect(result.data).toHaveLength(2);
      expect(result.data.every((r) => r.status === 'LOW')).toBe(true);
    });

    it('filter=ALL returns everything but sorts OUT_OF_STOCK first, then by deficit desc', async () => {
      const result = await service.findBalance(tenantId, {
        filter: StockBalanceFilter.ALL,
      });
      expect(result.data.map((r) => r.itemId)).toEqual(['d', 'c', 'b', 'a']);
    });

    it('breakdown reflects unfiltered counts even when filter narrows visible rows', async () => {
      const result = await service.findBalance(tenantId, {
        filter: StockBalanceFilter.LOW,
      });
      // Visible rows = 2, but the breakdown should still have OUT_OF_STOCK=1, LOW=2, OK=1
      expect(result.meta.breakdown).toEqual({
        OK: 1,
        LOW: 2,
        OUT_OF_STOCK: 1,
        OVERSTOCK: 0,
      });
    });
  });

  describe('open PO linkage', () => {
    it('attaches openPo info when an APPROVED/PARTIAL PO exists for the item+warehouse', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ itemId: 'item-1', warehouseId: 'wh-1', quantity: 30, reorderPoint: 100 }),
      ]);
      mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
        {
          itemId: 'item-1',
          quantity: 200,
          receivedQty: 50,
          purchaseOrder: {
            id: 'po-A',
            poNumber: 'PO-X',
            expectedDate: new Date('2026-05-01'),
            warehouseId: 'wh-1',
          },
        },
      ]);

      const result = await service.findBalance(tenantId, {});

      expect(result.data[0].openPo).toEqual({
        id: 'po-A',
        poNumber: 'PO-X',
        expectedDate: expect.any(Date),
        pendingQty: 150, // 200 - 50
      });
    });

    it('does NOT attach openPo when the PO is for a different warehouse', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ itemId: 'item-1', warehouseId: 'wh-1', quantity: 30, reorderPoint: 100 }),
      ]);
      mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
        {
          itemId: 'item-1',
          quantity: 200,
          receivedQty: 0,
          purchaseOrder: {
            id: 'po-A',
            poNumber: 'PO-X',
            expectedDate: null,
            warehouseId: 'wh-OTHER',
          },
        },
      ]);

      const result = await service.findBalance(tenantId, {});
      expect(result.data[0].openPo).toBeNull();
    });
  });

  describe('findExpiring', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    it('NEAR filter returns lots expiring within `days` window', async () => {
      const future = new Date(today);
      future.setDate(today.getDate() + 5);
      mockPrisma.inventoryLot.findMany.mockResolvedValue([
        {
          id: 'lot-1',
          lotNumber: 'L1',
          batchNumber: 'B1',
          itemId: 'item-1',
          warehouseId: 'wh-1',
          remainingQty: 100,
          unitCost: 10,
          expiryDate: future,
          receivedDate: today,
          item: { id: 'item-1', sku: 'SKU-1', name: 'Item', unit: 'PIECE' },
          warehouse: { id: 'wh-1', name: 'Main' },
        },
      ]);

      const result = await service.findExpiring(tenantId, {
        days: 30,
        filter: LotExpiryFilter.NEAR,
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('NEAR');
      expect(result[0].daysLeft).toBe(5);
      expect(result[0].value).toBe(1000); // 100 × 10
    });

    it('EXPIRED filter marks lots with negative daysLeft as EXPIRED', async () => {
      const past = new Date(today);
      past.setDate(today.getDate() - 3);
      mockPrisma.inventoryLot.findMany.mockResolvedValue([
        {
          id: 'lot-2',
          lotNumber: 'L2',
          batchNumber: null,
          itemId: 'item-2',
          warehouseId: 'wh-1',
          remainingQty: 50,
          unitCost: 20,
          expiryDate: past,
          receivedDate: today,
          item: { id: 'item-2', sku: 'SKU-2', name: 'Bread', unit: 'PIECE' },
          warehouse: { id: 'wh-1', name: 'Main' },
        },
      ]);

      const result = await service.findExpiring(tenantId, {
        days: 30,
        filter: LotExpiryFilter.EXPIRED,
      });

      expect(result[0].status).toBe('EXPIRED');
      expect(result[0].daysLeft).toBe(-3);
    });
  });

  describe('getSummary', () => {
    it('aggregates LOW / OVERSTOCK / expiry counts and total stock value', async () => {
      mockPrisma.warehouseStock.findMany.mockResolvedValue([
        stock({ itemId: 'a', quantity: 30, reorderPoint: 100 }), // LOW
        stock({ itemId: 'b', quantity: 0, reorderPoint: 50 }), // OUT
        stock({ itemId: 'c', quantity: 5000, reorderPoint: 100, maxStock: 1000 }), // OVER
      ]);
      mockPrisma.inventoryLot.count
        .mockResolvedValueOnce(7) // nearExpiry
        .mockResolvedValueOnce(2); // expired
      mockPrisma.warehouseStock.aggregate.mockResolvedValue({
        _sum: { totalValue: 1_234_567 },
      });

      const result = await service.getSummary(tenantId);

      expect(result.lowCount).toBe(1);
      expect(result.outOfStockCount).toBe(1);
      expect(result.overstockCount).toBe(1);
      expect(result.nearExpiryCount).toBe(7);
      expect(result.expiredCount).toBe(2);
      expect(result.totalStockValue).toBe(1_234_567);
    });
  });
});
