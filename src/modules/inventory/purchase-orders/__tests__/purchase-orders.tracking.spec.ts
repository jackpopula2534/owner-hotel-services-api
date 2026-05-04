import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { PrismaService } from '@/prisma/prisma.service';
import { PurchaseOrderTrackingStatus } from '../dto/query-purchase-order-tracking.dto';

/**
 * Sprint 1 — Unit tests for `findTracking()` on PurchaseOrdersService.
 *
 * These tests exercise the receiving-pipeline rollup logic without a real DB.
 * The Prisma client is fully mocked; what we care about is:
 *
 *   1. The shape of the returned row (progress %, days overdue, latest GR)
 *   2. That overdue=true narrows the where-clause correctly
 *   3. That the summary aggregates across the full filtered set
 */
describe('PurchaseOrdersService — findTracking()', () => {
  let service: PurchaseOrdersService;

  const tenantId = 'tenant-001';

  // Two days ago, normalized to midnight — used so isOverdue resolves predictably.
  const TWO_DAYS_AGO = new Date();
  TWO_DAYS_AGO.setHours(0, 0, 0, 0);
  TWO_DAYS_AGO.setDate(TWO_DAYS_AGO.getDate() - 2);

  const TOMORROW = new Date();
  TOMORROW.setHours(0, 0, 0, 0);
  TOMORROW.setDate(TOMORROW.getDate() + 1);

  // Sample PO rows the mocked findMany returns. Each shape mirrors what the
  // service's `select` clause produces.
  const samplePoRows = [
    // Row A: APPROVED, overdue by 2 days, 0 received
    {
      id: 'po-A',
      poNumber: 'PO-202604-0001',
      status: 'APPROVED',
      expectedDate: TWO_DAYS_AGO,
      approvedAt: new Date(),
      createdAt: new Date(),
      totalAmount: 100_000,
      currency: 'THB',
      supplierId: 'sup-1',
      warehouseId: 'wh-1',
      supplier: { name: 'Acme Supplier' },
      items: [
        { quantity: 100, receivedQty: 0 },
        { quantity: 50, receivedQty: 0 },
      ],
      goodsReceives: [],
    },
    // Row B: PARTIALLY_RECEIVED, on-time, 60% received, has latest GR
    {
      id: 'po-B',
      poNumber: 'PO-202604-0002',
      status: 'PARTIALLY_RECEIVED',
      expectedDate: TOMORROW,
      approvedAt: new Date(),
      createdAt: new Date(),
      totalAmount: 50_000,
      currency: 'THB',
      supplierId: 'sup-2',
      warehouseId: 'wh-1',
      supplier: { name: 'Beta Supplier' },
      items: [
        { quantity: 100, receivedQty: 60 }, // 60% on this line
      ],
      goodsReceives: [
        {
          id: 'gr-1',
          grNumber: 'GR-202604-0001',
          status: 'ACCEPTED',
          receiveDate: new Date(),
        },
      ],
    },
  ];

  const mockPrismaService = {
    purchaseOrder: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    warehouse: {
      findMany: jest.fn().mockResolvedValue([{ id: 'wh-1', name: 'Main Warehouse' }]),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  describe('progress rollup', () => {
    beforeEach(() => {
      mockPrismaService.purchaseOrder.findMany
        // First call: paged list
        .mockResolvedValueOnce(samplePoRows)
        // Subsequent calls inside computeTrackingSummary
        .mockResolvedValue([]);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(0); // summary counts
    });

    it('computes orderedQty, receivedQty, pendingQty, percent for each PO', async () => {
      mockPrismaService.purchaseOrder.count.mockResolvedValueOnce(2); // total for paged query

      const result = await service.findTracking(tenantId, {});

      expect(result.data).toHaveLength(2);

      const rowA = result.data[0];
      expect(rowA.id).toBe('po-A');
      expect(rowA.progress.orderedQty).toBe(150);
      expect(rowA.progress.receivedQty).toBe(0);
      expect(rowA.progress.pendingQty).toBe(150);
      expect(rowA.progress.percent).toBe(0);
      expect(rowA.progress.lineCount).toBe(2);
      expect(rowA.progress.receivedLineCount).toBe(0);
      expect(rowA.progress.pendingLineCount).toBe(2);

      const rowB = result.data[1];
      expect(rowB.progress.orderedQty).toBe(100);
      expect(rowB.progress.receivedQty).toBe(60);
      expect(rowB.progress.pendingQty).toBe(40);
      expect(rowB.progress.percent).toBe(60);
    });

    it('flags overdue rows and computes daysOverdue', async () => {
      mockPrismaService.purchaseOrder.count.mockResolvedValueOnce(2);

      const result = await service.findTracking(tenantId, {});

      expect(result.data[0].isOverdue).toBe(true);
      expect(result.data[0].daysOverdue).toBe(2);
      // Row B has expectedDate=tomorrow → not overdue
      expect(result.data[1].isOverdue).toBe(false);
      expect(result.data[1].daysOverdue).toBe(0);
    });

    it('returns latest GR when one is linked, null otherwise', async () => {
      mockPrismaService.purchaseOrder.count.mockResolvedValueOnce(2);

      const result = await service.findTracking(tenantId, {});

      expect(result.data[0].latestGr).toBeNull();
      expect(result.data[1].latestGr).toEqual({
        id: 'gr-1',
        grNumber: 'GR-202604-0001',
        status: 'ACCEPTED',
        receiveDate: expect.any(Date),
      });
    });

    it('resolves warehouse name via the supplemental warehouse query', async () => {
      mockPrismaService.purchaseOrder.count.mockResolvedValueOnce(2);

      const result = await service.findTracking(tenantId, {});

      expect(result.data[0].warehouse).toEqual({
        id: 'wh-1',
        name: 'Main Warehouse',
      });
      expect(mockPrismaService.warehouse.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['wh-1'] } },
        select: { id: true, name: true },
      });
    });
  });

  describe('filters', () => {
    beforeEach(() => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(0);
    });

    it('defaults to all post-approval statuses when status filter is omitted', async () => {
      await service.findTracking(tenantId, {});

      const where = mockPrismaService.purchaseOrder.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({
        in: ['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
      });
    });

    it('narrows to a single status when provided', async () => {
      await service.findTracking(tenantId, {
        status: PurchaseOrderTrackingStatus.PARTIALLY_RECEIVED,
      });

      const where = mockPrismaService.purchaseOrder.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['PARTIALLY_RECEIVED'] });
    });

    it('overdue=true filters to expectedDate<today AND APPROVED|PARTIAL only', async () => {
      await service.findTracking(tenantId, { overdue: true });

      const where = mockPrismaService.purchaseOrder.findMany.mock.calls[0][0].where;
      expect(where.expectedDate).toEqual({ lt: expect.any(Date) });
      expect(where.status).toEqual({
        in: ['APPROVED', 'PARTIALLY_RECEIVED'],
      });
    });

    it('passes through supplierId, warehouseId, and search filters', async () => {
      await service.findTracking(tenantId, {
        supplierId: 'sup-X',
        warehouseId: 'wh-X',
        search: 'PO-2026',
      });

      const where = mockPrismaService.purchaseOrder.findMany.mock.calls[0][0].where;
      expect(where.supplierId).toBe('sup-X');
      expect(where.warehouseId).toBe('wh-X');
      expect(where.poNumber).toEqual({ contains: 'PO-2026' });
    });
  });

  describe('summary', () => {
    it('aggregates counts and pending-value across full filtered set', async () => {
      // Page query returns 0 rows — we just want to verify summary math.
      mockPrismaService.purchaseOrder.findMany
        .mockResolvedValueOnce([]) // main paged list
        .mockResolvedValueOnce([
          // approvedRows: 1 PO @ 100k, 0% received → pendingValue 100k
          {
            totalAmount: 100_000,
            items: [{ quantity: 100, receivedQty: 0 }],
          },
        ])
        .mockResolvedValueOnce([
          // partialRows: 1 PO @ 50k, 60% received → pendingValue 20k
          {
            totalAmount: 50_000,
            items: [{ quantity: 100, receivedQty: 60 }],
          },
        ]);
      mockPrismaService.purchaseOrder.count
        .mockResolvedValueOnce(0) // total for paged query
        .mockResolvedValueOnce(7) // full count
        .mockResolvedValueOnce(3) // closed count
        .mockResolvedValueOnce(2); // overdue count

      const result = await service.findTracking(tenantId, {});

      expect(result.meta.summary.approvedAwaiting).toBe(1);
      expect(result.meta.summary.partial).toBe(1);
      expect(result.meta.summary.full).toBe(7);
      expect(result.meta.summary.closed).toBe(3);
      expect(result.meta.summary.overdue).toBe(2);
      expect(result.meta.summary.totalValue).toBe(150_000);
      expect(result.meta.summary.pendingValue).toBe(120_000); // 100k + 20k
    });
  });
});
