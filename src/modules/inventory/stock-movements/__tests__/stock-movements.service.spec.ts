import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockMovementsService } from '../stock-movements.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Unit tests covering the response-shape regressions surfaced on the
 * "รับ/เบิกสินค้า" page:
 *
 *   - product/SKU rendered as "N/A" / "—"  → mapToDetail must emit nested
 *     `item` (and keep legacy `itemName` / `itemSku` aliases).
 *   - warehouse rendered as "—"            → mapToDetail must emit nested
 *     `warehouse` (and keep legacy `warehouseName`).
 *   - value rendered as "฿NaN"             → mapToDetail must coerce
 *     Decimal/string `totalCost` and `unitCost` into finite numbers and
 *     expose the value as both `totalCost` (canonical) and `totalValue`
 *     (legacy alias).
 *   - actor column rendered as raw UUID    → findAll must resolve the
 *     `createdBy` UUID against the User table in a single batch query and
 *     attach `createdByName` + `createdByUser` to every row.
 */
describe('StockMovementsService — list response shape', () => {
  const tenantId = 'tenant-001';
  const userId = 'user-actor-1';
  const userIdMissing = 'user-missing';

  let service: StockMovementsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      stockMovement: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockMovementsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(StockMovementsService);
  });

  /**
   * `mapToDetail` is private — exercise it via `(service as any).mapToDetail`
   * so we can pin the response shape without driving the whole findAll path.
   */
  describe('mapToDetail', () => {
    const baseMovement = {
      id: 'mv-1',
      tenantId,
      warehouseId: 'wh-1',
      itemId: 'item-1',
      type: 'GOODS_RECEIVE',
      quantity: 24,
      // Prisma returns Decimal — emulate the toNumber() interface so the
      // service must coerce it instead of forwarding the object verbatim.
      unitCost: { toNumber: () => 573.18 },
      totalCost: { toNumber: () => 13756.32 },
      referenceType: 'GOODS_RECEIVE',
      referenceId: '1eab4484-aaaa-bbbb-cccc-ddddeeeeffff',
      transferWarehouseId: null,
      notes: null,
      batchNumber: null,
      expiryDate: null,
      lotId: null,
      lot: null,
      createdBy: userId,
      createdAt: new Date('2026-04-28T03:00:00Z'),
      updatedAt: new Date('2026-04-28T03:00:00Z'),
      warehouse: { id: 'wh-1', name: 'คลังกลาง' },
      item: { id: 'item-1', name: 'ผ้าเช็ดตัว', sku: 'TWL-001' },
    };

    it('emits both nested objects and legacy flat aliases for item/warehouse', () => {
      const detail = (service as any).mapToDetail(baseMovement);

      // Nested shape expected by the new frontend.
      expect(detail.item).toEqual({ id: 'item-1', name: 'ผ้าเช็ดตัว', sku: 'TWL-001' });
      expect(detail.warehouse).toEqual({ id: 'wh-1', name: 'คลังกลาง' });

      // Legacy flat aliases preserved for any older consumer.
      expect(detail.itemName).toBe('ผ้าเช็ดตัว');
      expect(detail.itemSku).toBe('TWL-001');
      expect(detail.warehouseName).toBe('คลังกลาง');
    });

    it('coerces Prisma Decimal cost fields into finite numbers (no NaN)', () => {
      const detail = (service as any).mapToDetail(baseMovement);

      expect(typeof detail.totalCost).toBe('number');
      expect(typeof detail.unitCost).toBe('number');
      expect(detail.totalCost).toBe(13756.32);
      expect(detail.unitCost).toBe(573.18);
      // totalValue is the legacy alias — must mirror totalCost.
      expect(detail.totalValue).toBe(detail.totalCost);
    });

    it('coerces string-encoded Decimal values without producing NaN', () => {
      const detail = (service as any).mapToDetail({
        ...baseMovement,
        unitCost: '2288.68',
        totalCost: '54928.32',
      });

      expect(detail.unitCost).toBe(2288.68);
      expect(detail.totalCost).toBe(54928.32);
      expect(detail.totalValue).toBe(54928.32);
      expect(Number.isFinite(detail.totalCost)).toBe(true);
    });

    it('falls back to 0 (not NaN) when cost fields are null/undefined/garbage', () => {
      const detail = (service as any).mapToDetail({
        ...baseMovement,
        unitCost: null,
        totalCost: undefined,
      });

      expect(detail.unitCost).toBe(0);
      expect(detail.totalCost).toBe(0);
      expect(detail.totalValue).toBe(0);

      const detail2 = (service as any).mapToDetail({
        ...baseMovement,
        unitCost: 'not-a-number',
        totalCost: 'also-bad',
      });
      expect(detail2.unitCost).toBe(0);
      expect(detail2.totalCost).toBe(0);
    });

    it('attaches resolved actor under createdByName + createdByUser', () => {
      const user = {
        id: userId,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        email: 'somchai@example.com',
      };

      const detail = (service as any).mapToDetail(baseMovement, user);

      expect(detail.createdBy).toBe(userId); // raw UUID still preserved
      expect(detail.createdByName).toBe('สมชาย ใจดี');
      expect(detail.createdByUser).toEqual(user);
    });

    it('uses email when first/last name are blank', () => {
      const detail = (service as any).mapToDetail(baseMovement, {
        id: userId,
        firstName: null,
        lastName: null,
        email: 'fallback@example.com',
      });

      expect(detail.createdByName).toBe('fallback@example.com');
    });

    it('leaves createdByName undefined when the user is not resolved', () => {
      const detail = (service as any).mapToDetail(baseMovement);

      expect(detail.createdByName).toBeUndefined();
      expect(detail.createdByUser).toBeNull();
    });
  });

  describe('findAll — actor batch resolution', () => {
    it('resolves all unique createdBy IDs in a single user.findMany call', async () => {
      const movements = [
        {
          id: 'mv-1',
          tenantId,
          warehouseId: 'wh-1',
          itemId: 'item-1',
          type: 'GOODS_RECEIVE',
          quantity: 48,
          unitCost: { toNumber: () => 573.18 },
          totalCost: { toNumber: () => 27512.64 },
          referenceType: 'GOODS_RECEIVE',
          referenceId: 'ref-1',
          transferWarehouseId: null,
          notes: null,
          batchNumber: null,
          expiryDate: null,
          lotId: null,
          lot: null,
          createdBy: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          warehouse: { id: 'wh-1', name: 'คลังกลาง' },
          item: { id: 'item-1', name: 'ผ้าเช็ดตัว', sku: 'TWL-001' },
        },
        {
          id: 'mv-2',
          tenantId,
          warehouseId: 'wh-1',
          itemId: 'item-1',
          type: 'GOODS_RECEIVE',
          quantity: 36,
          unitCost: { toNumber: () => 2288.68 },
          totalCost: { toNumber: () => 82392.48 },
          referenceType: 'GOODS_RECEIVE',
          referenceId: 'ref-2',
          transferWarehouseId: null,
          notes: null,
          batchNumber: null,
          expiryDate: null,
          lotId: null,
          lot: null,
          createdBy: userId, // same user — must dedupe
          createdAt: new Date(),
          updatedAt: new Date(),
          warehouse: { id: 'wh-1', name: 'คลังกลาง' },
          item: { id: 'item-1', name: 'ผ้าเช็ดตัว', sku: 'TWL-001' },
        },
        {
          id: 'mv-3',
          tenantId,
          warehouseId: 'wh-1',
          itemId: 'item-2',
          type: 'GOODS_ISSUE',
          quantity: 12,
          unitCost: { toNumber: () => 100 },
          totalCost: { toNumber: () => 1200 },
          referenceType: null,
          referenceId: null,
          transferWarehouseId: null,
          notes: null,
          batchNumber: null,
          expiryDate: null,
          lotId: null,
          lot: null,
          createdBy: userIdMissing, // user no longer exists in DB
          createdAt: new Date(),
          updatedAt: new Date(),
          warehouse: { id: 'wh-1', name: 'คลังกลาง' },
          item: { id: 'item-2', name: 'น้ำยา', sku: 'CLN-002' },
        },
      ];

      mockPrisma.stockMovement.findMany.mockResolvedValue(movements);
      mockPrisma.stockMovement.count.mockResolvedValue(movements.length);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: userId, firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@example.com' },
      ]);

      const result = await service.findAll(tenantId, { page: 1, limit: 20 } as any);

      // Single batched query, deduped IDs.
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      const call = mockPrisma.user.findMany.mock.calls[0][0];
      const requestedIds: string[] = call.where.id.in;
      expect(requestedIds.sort()).toEqual([userId, userIdMissing].sort());

      // Resolved user is stitched in.
      expect(result.data[0].createdByName).toBe('สมชาย ใจดี');
      expect(result.data[1].createdByName).toBe('สมชาย ใจดี');

      // Missing user → null relation, undefined display name (frontend falls back to "—").
      expect(result.data[2].createdByUser).toBeNull();
      expect(result.data[2].createdByName).toBeUndefined();

      // Sanity: all rows have nested item/warehouse + numeric totals.
      for (const row of result.data) {
        expect(row.item).toBeDefined();
        expect(row.warehouse).toBeDefined();
        expect(typeof row.totalCost).toBe('number');
        expect(Number.isFinite(row.totalCost)).toBe(true);
      }
    });

    it('skips the user lookup entirely when the page has no movements', async () => {
      mockPrisma.stockMovement.findMany.mockResolvedValue([]);
      mockPrisma.stockMovement.count.mockResolvedValue(0);

      const result = await service.findAll(tenantId, { page: 1, limit: 20 } as any);

      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });
});
