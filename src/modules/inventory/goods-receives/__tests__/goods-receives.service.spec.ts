import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GoodsReceivesService } from '../goods-receives.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateGoodsReceiveDto } from '../dto/create-goods-receive.dto';

/**
 * Unit tests covering every branch of GoodsReceivesService.create:
 *   - Ad-hoc GR (no PO)
 *   - PO-linked GR (APPROVED → FULLY_RECEIVED transition)
 *   - PO-linked partial GR (APPROVED → PARTIALLY_RECEIVED transition)
 *   - Perishable item → auto-creates InventoryLot via generateLotNumber
 *   - requiresLotTracking item → auto-creates InventoryLot
 *   - Items entirely rejected → no stock movement, no lot
 *   - Warehouse not found → NotFoundException
 *   - PO not found → NotFoundException
 *   - PO in wrong status → ConflictException
 *   - Inventory item not found mid-transaction → NotFoundException
 *   - generateLotNumber uses schema-correct field names (regression for
 *     the Prisma VALIDATION_ERROR caused by currentNumber/lastNumber mixup)
 *   - totalAmount/subtotal persisted on GR header
 */
describe('GoodsReceivesService', () => {
  const tenantId = 'tenant-001';
  const userId = 'user-001';
  const warehouseId = 'wh-001';
  const poId = 'po-001';
  const itemPerishable = 'item-perish';
  const itemNonPerishable = 'item-std';
  const itemLotTracked = 'item-lot';

  let service: GoodsReceivesService;
  let mockPrisma: any;
  let createdGrId: string;

  const buildMock = () => {
    const state = {
      grInserted: null as any,
      grItemsInserted: [] as any[],
      lotInserted: null as any,
      stockMovements: [] as any[],
      poItemUpdates: [] as any[],
      poStatusUpdate: null as any,
      grHeaderUpdate: null as any,
      sequenceCalls: [] as any[],
      inventoryLotInserts: [] as any[],
      warehouseStockUpserts: [] as any[],
    };

    const warehouseRow = { id: warehouseId, tenantId, name: 'คลังกลาง' };

    const poRow = {
      id: poId,
      tenantId,
      poNumber: 'PO-202604-0001',
      supplierId: 'sup-1',
      status: 'APPROVED',
      items: [
        { id: 'poi-1', itemId: itemPerishable, quantity: 10, receivedQty: 0 },
        { id: 'poi-2', itemId: itemNonPerishable, quantity: 5, receivedQty: 0 },
      ],
    };

    const itemRows: Record<string, any> = {
      [itemPerishable]: {
        id: itemPerishable,
        isPerishable: true,
        defaultShelfLifeDays: 30,
        requiresLotTracking: false,
      },
      [itemNonPerishable]: {
        id: itemNonPerishable,
        isPerishable: false,
        requiresLotTracking: false,
      },
      [itemLotTracked]: {
        id: itemLotTracked,
        isPerishable: false,
        requiresLotTracking: true,
      },
    };

    mockPrisma = {
      __state: state,
      $transaction: jest.fn((fn: any) => fn(mockPrisma)),
      warehouse: {
        findUnique: jest.fn().mockResolvedValue(warehouseRow),
      },
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue(poRow),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          state.poStatusUpdate = { where, data };
          return { ...poRow, ...data };
        }),
      },
      purchaseOrderItem: {
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          state.poItemUpdates.push({ where, data });
          const existing = poRow.items.find((i) => i.id === where.id);
          if (existing) existing.receivedQty = data.receivedQty;
          return existing;
        }),
        findMany: jest.fn().mockImplementation(() => poRow.items),
      },
      inventoryItem: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => itemRows[where.id] ?? null),
      },
      goodsReceive: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          createdGrId = 'gr-created';
          state.grInserted = {
            id: createdGrId,
            subtotal: 0,
            totalAmount: 0,
            ...data,
          };
          return state.grInserted;
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          state.grHeaderUpdate = { where, data };
          if (state.grInserted && where.id === state.grInserted.id) {
            Object.assign(state.grInserted, data);
          }
          return { ...state.grInserted };
        }),
      },
      goodsReceiveItem: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: `gri-${state.grItemsInserted.length + 1}`, ...data };
          state.grItemsInserted.push(row);
          return row;
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const target = state.grItemsInserted.find((r) => r.id === where.id);
          if (target) Object.assign(target, data);
          return target;
        }),
      },
      inventoryLot: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: `lot-${state.inventoryLotInserts.length + 1}`, ...data };
          state.inventoryLotInserts.push(row);
          state.lotInserted = row;
          return row;
        }),
      },
      stockMovement: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          state.stockMovements.push(data);
          return data;
        }),
      },
      warehouseStock: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => {
          state.warehouseStockUpserts.push({ op: 'create', data });
          return data;
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          state.warehouseStockUpserts.push({ op: 'update', where, data });
          return data;
        }),
      },
      documentSequence: {
        upsert: jest.fn().mockImplementation(({ where, create, update }: any) => {
          state.sequenceCalls.push({ where, create, update });
          // Simulate first-ever sequence for both GR and LOT
          return { lastNumber: 1, prefix: create?.prefix ?? 'GR' };
        }),
      },
    };

    return { mockPrisma, poRow, warehouseRow, state, itemRows };
  };

  beforeEach(async () => {
    buildMock();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceivesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(GoodsReceivesService);
  });

  const baseDto = (overrides?: Partial<CreateGoodsReceiveDto>): CreateGoodsReceiveDto => ({
    warehouseId,
    items: [
      { itemId: itemNonPerishable, receivedQty: 5, unitCost: 100 },
    ],
    ...overrides,
  });

  // ─── Happy paths ──────────────────────────────────────────────────────────
  it('creates an ad-hoc GR (no PO) and skips PO mutations', async () => {
    await service.create(baseDto(), userId, tenantId);

    expect(mockPrisma.goodsReceive.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.purchaseOrderItem.update).not.toHaveBeenCalled();
    // Non-perishable item → no lot was created
    expect(mockPrisma.inventoryLot.create).not.toHaveBeenCalled();
    // Stock movement still fires for accepted qty
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('receives against an APPROVED PO and marks it FULLY_RECEIVED when all qty received', async () => {
    await service.create(
      baseDto({
        purchaseOrderId: poId,
        items: [
          { itemId: itemPerishable, receivedQty: 10, unitCost: 50 },
          { itemId: itemNonPerishable, receivedQty: 5, unitCost: 20 },
        ],
      }),
      userId,
      tenantId,
    );

    const poStatus = mockPrisma.__state.poStatusUpdate;
    expect(poStatus).not.toBeNull();
    expect(poStatus.data.status).toBe('FULLY_RECEIVED');
  });

  it('marks PO PARTIALLY_RECEIVED when only some qty is received', async () => {
    await service.create(
      baseDto({
        purchaseOrderId: poId,
        items: [{ itemId: itemPerishable, receivedQty: 4, unitCost: 50 }],
      }),
      userId,
      tenantId,
    );

    const poStatus = mockPrisma.__state.poStatusUpdate;
    expect(poStatus).not.toBeNull();
    expect(poStatus.data.status).toBe('PARTIALLY_RECEIVED');
  });

  // ─── Perishable / lot-tracked handling ────────────────────────────────────
  it('auto-creates an InventoryLot for perishable items and links lotId onto the GR item', async () => {
    await service.create(
      baseDto({
        items: [{ itemId: itemPerishable, receivedQty: 3, unitCost: 80 }],
      }),
      userId,
      tenantId,
    );

    expect(mockPrisma.inventoryLot.create).toHaveBeenCalledTimes(1);
    const createdLot = mockPrisma.inventoryLot.create.mock.calls[0][0].data;
    expect(createdLot.itemId).toBe(itemPerishable);
    expect(createdLot.initialQty).toBe(3);
    expect(createdLot.remainingQty).toBe(3);
    // Fallback shelf-life date is applied when caller didn't provide one
    expect(createdLot.expiryDate).toBeInstanceOf(Date);

    // GR item has been updated with the lotId back-reference
    const grItemUpdate = mockPrisma.goodsReceiveItem.update.mock.calls[0][0];
    expect(grItemUpdate.data.lotId).toMatch(/^lot-/);
  });

  it('auto-creates a lot for items with requiresLotTracking even when not perishable', async () => {
    await service.create(
      baseDto({
        items: [{ itemId: itemLotTracked, receivedQty: 2, unitCost: 500 }],
      }),
      userId,
      tenantId,
    );

    expect(mockPrisma.inventoryLot.create).toHaveBeenCalledTimes(1);
  });

  // ─── Regression: sequence schema fields ───────────────────────────────────
  it('uses schema-correct DocumentSequence fields (lastNumber + prefix) — both GR and LOT', async () => {
    await service.create(
      baseDto({
        items: [{ itemId: itemPerishable, receivedQty: 1, unitCost: 10 }],
      }),
      userId,
      tenantId,
    );

    const calls = mockPrisma.__state.sequenceCalls;
    // One call per docType
    expect(calls.length).toBe(2);
    for (const c of calls) {
      // create payload must include `prefix` and `lastNumber` (not `currentNumber`)
      expect(c.create.prefix).toBeDefined();
      expect(c.create.lastNumber).toBe(1);
      expect(c.create).not.toHaveProperty('currentNumber');
      // update payload must increment `lastNumber` — not `currentNumber`
      expect(c.update.lastNumber).toEqual({ increment: 1 });
      expect(c.update).not.toHaveProperty('currentNumber');
    }
  });

  // ─── Monetary totals ──────────────────────────────────────────────────────
  it('persists subtotal + totalAmount computed from accepted qty * unit cost (excluding rejected)', async () => {
    await service.create(
      baseDto({
        items: [
          { itemId: itemNonPerishable, receivedQty: 5, rejectedQty: 1, unitCost: 100 },
        ],
      }),
      userId,
      tenantId,
    );

    expect(mockPrisma.goodsReceive.update).toHaveBeenCalled();
    const headerUpdate = mockPrisma.__state.grHeaderUpdate.data;
    // Accepted = 5 - 1 = 4 units * 100 = 400
    expect(Number(headerUpdate.subtotal)).toBe(400);
    expect(Number(headerUpdate.totalAmount)).toBe(400);
  });

  it('skips stock movement and lot creation when 100% of the line is rejected', async () => {
    await service.create(
      baseDto({
        items: [
          {
            itemId: itemPerishable,
            receivedQty: 5,
            rejectedQty: 5,
            unitCost: 10,
            rejectReason: 'all damaged',
          },
        ],
      }),
      userId,
      tenantId,
    );

    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.inventoryLot.create).not.toHaveBeenCalled();
    // Header totals stay at zero → no update call (condition: computedTotal > 0)
    expect(mockPrisma.goodsReceive.update).not.toHaveBeenCalled();
  });

  // ─── Warehouse stock weighted average ─────────────────────────────────────
  it('creates warehouse stock row when none exists', async () => {
    await service.create(baseDto(), userId, tenantId);

    const upserts = mockPrisma.__state.warehouseStockUpserts;
    expect(upserts.length).toBe(1);
    expect(upserts[0].op).toBe('create');
    expect(upserts[0].data.quantity).toBe(5);
    expect(Number(upserts[0].data.avgCost)).toBe(100);
  });

  it('computes weighted avg cost when warehouse stock already exists', async () => {
    mockPrisma.warehouseStock.findUnique.mockResolvedValue({
      warehouseId,
      itemId: itemNonPerishable,
      quantity: 10,
      avgCost: 50,
    });

    await service.create(baseDto(), userId, tenantId);

    const upserts = mockPrisma.__state.warehouseStockUpserts;
    expect(upserts.length).toBe(1);
    expect(upserts[0].op).toBe('update');
    // ((10 * 50) + (5 * 100)) / 15 = 1000/15 = 66.666...
    expect(Number(upserts[0].data.avgCost)).toBeCloseTo(66.67, 1);
    expect(upserts[0].data.quantity).toBe(15);
  });

  // ─── Error paths ──────────────────────────────────────────────────────────
  it('throws NotFoundException when warehouse is missing', async () => {
    mockPrisma.warehouse.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto(), userId, tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when warehouse belongs to a different tenant', async () => {
    mockPrisma.warehouse.findUnique.mockResolvedValue({
      id: warehouseId,
      tenantId: 'other-tenant',
      name: 'x',
    });
    await expect(service.create(baseDto(), userId, tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the linked PO is missing', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
    await expect(
      service.create(baseDto({ purchaseOrderId: poId }), userId, tenantId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when PO status is DRAFT', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      id: poId,
      tenantId,
      poNumber: 'PO-X',
      status: 'DRAFT',
      items: [],
    });
    await expect(
      service.create(baseDto({ purchaseOrderId: poId }), userId, tenantId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ConflictException when PO status is FULLY_RECEIVED', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      id: poId,
      tenantId,
      poNumber: 'PO-X',
      status: 'FULLY_RECEIVED',
      items: [],
    });
    await expect(
      service.create(baseDto({ purchaseOrderId: poId }), userId, tenantId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when an item on the line was deleted from catalog', async () => {
    mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);
    await expect(service.create(baseDto(), userId, tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ─── Regression: receivedBy / userId wiring ───────────────────────────────
  // Guards against the JWT payload bug where controllers read `user.sub`
  // (undefined) and propagate it as `receivedBy: undefined` into Prisma,
  // which surfaced to clients as "Argument `receivedBy` is missing".
  it('persists receivedBy = userId onto the GoodsReceive header', async () => {
    await service.create(baseDto(), userId, tenantId);

    expect(mockPrisma.goodsReceive.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.goodsReceive.create.mock.calls[0][0];
    expect(createArgs.data.receivedBy).toBe(userId);
  });

  it('throws BadRequestException when userId is missing (JWT payload bug guard)', async () => {
    await expect(
      service.create(baseDto(), undefined as unknown as string, tenantId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.goodsReceive.create).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when tenantId is missing', async () => {
    await expect(
      service.create(baseDto(), userId, undefined as unknown as string),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.goodsReceive.create).not.toHaveBeenCalled();
  });

  // ─── Inspect ──────────────────────────────────────────────────────────────
  describe('inspect', () => {
    it('rejects when GR is not in ACCEPTED status', async () => {
      mockPrisma.goodsReceive.findUnique = jest.fn().mockResolvedValue({
        id: 'g1',
        tenantId,
        status: 'DRAFT',
      });
      await expect(
        service.inspect('g1', userId, tenantId, 'INSPECTING'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the GR belongs to another tenant', async () => {
      mockPrisma.goodsReceive.findUnique = jest.fn().mockResolvedValue({
        id: 'g1',
        tenantId: 'other',
        status: 'ACCEPTED',
      });
      await expect(
        service.inspect('g1', userId, tenantId, 'INSPECTING'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
