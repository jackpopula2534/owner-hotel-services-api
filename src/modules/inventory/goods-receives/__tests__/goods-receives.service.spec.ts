import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GoodsReceivesService } from '../goods-receives.service';
import { PrismaService } from '@/prisma/prisma.service';
import { StorageService } from '@/common/storage/storage.service';
import type { CreateGoodsReceiveDto } from '../dto/create-goods-receive.dto';
import type { CreateCashPurchaseDto } from '../dto/create-cash-purchase.dto';

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
      qcRecordsInserted: [] as any[],
      attachmentsInserted: [] as any[],
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
        findFirst: jest.fn().mockResolvedValue(warehouseRow),
      },
      // `paidBy` is client-supplied and must be a user inside this tenant.
      // Default: anyone named exists. Tests that probe the guard override it.
      user: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) => ({ id: where.id, tenantId: where.tenantId })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue(poRow),
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
        // 2026-04-25 — DRAFT-first refactor batches the lookup. Both findUnique
        // (still used inside _applyAcceptance loop) and findMany (used at the
        // top of create() to compute requiresQC) are exercised by tests.
        findMany: jest.fn().mockImplementation(({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return ids.map((id) => itemRows[id]).filter(Boolean);
        }),
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
      goodsReceiveAttachment: {
        createMany: jest.fn().mockImplementation(({ data }: any) => {
          state.attachmentsInserted.push(...data);
          return { count: data.length };
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
      // QC tables only see traffic when an item with requiresQC=true is
      // received. Default mocks return empty so non-QC tests stay quiet;
      // tests that exercise the QC branch override them per-case.
      qCTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      qCRecord: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const row = { id: `qcr-${state.qcRecordsInserted.length + 1}`, ...data };
          state.qcRecordsInserted.push(row);
          return row;
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

  // Sprint 2: GR service now emits `gr.completed` / `po.received` after the
  // transaction. Tests don't care about delivery, only that the constructor
  // can be satisfied — a no-op emit() mock is enough.
  const mockEventEmitter = { emit: jest.fn() };

  // Only ever asked for CASH_PURCHASE_MAX_AMOUNT. Returning undefined exercises
  // the built-in ฿5,000 fallback, which is what an unconfigured deployment gets.
  const mockConfig = { get: jest.fn().mockReturnValue(undefined) };

  // Slips only ever need a key → URL translation here; the real driver choice
  // (local vs S3) is StorageService's own concern, not this service's.
  const mockStorage = {
    publicPath: jest.fn((key: string) => `/uploads/${key}`),
    saveMany: jest.fn(),
  };

  beforeEach(async () => {
    buildMock();
    mockEventEmitter.emit.mockClear();
    // Resolve EventEmitter2 lazily to avoid a top-level require that would
    // break if the package were ever swapped.
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceivesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfig },
        { provide: StorageService, useValue: mockStorage },
      ],
    }).compile();
    service = moduleRef.get(GoodsReceivesService);
  });

  const baseDto = (overrides?: Partial<CreateGoodsReceiveDto>): CreateGoodsReceiveDto => ({
    warehouseId,
    items: [{ itemId: itemNonPerishable, receivedQty: 5, unitCost: 100 }],
    ...overrides,
  });

  // ─── Happy paths ──────────────────────────────────────────────────────────
  it('creates an ad-hoc GR (no PO) and skips PO mutations', async () => {
    await service.create(baseDto(), userId, tenantId);

    expect(mockPrisma.goodsReceive.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.purchaseOrder.findFirst).not.toHaveBeenCalled();
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

  // ─── DRAFT-first flow (proper international GRN) ──────────────────────────
  describe('DRAFT-first flow — items requiring QC', () => {
    it('creates GR as DRAFT and skips stock writes when an item requires QC', async () => {
      // Add a QC-required item to the catalog
      mockPrisma.__state = mockPrisma.__state ?? {};
      const itemRequiringQC = 'item-needs-qc';
      mockPrisma.inventoryItem.findMany.mockImplementationOnce(({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id: string) => ({
          id,
          isPerishable: false,
          requiresLotTracking: false,
          requiresQC: id === itemRequiringQC,
          defaultQCTemplateId: id === itemRequiringQC ? 'tpl-1' : null,
        }));
      });

      await service.create(
        baseDto({
          items: [{ itemId: itemRequiringQC, receivedQty: 5, unitCost: 100 }],
        }),
        userId,
        tenantId,
      );

      // GR was inserted as DRAFT
      expect(mockPrisma.goodsReceive.create.mock.calls[0][0].data.status).toBe('DRAFT');
      // No stock movement, no lot, no PO updates — all deferred to accept()
      expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryLot.create).not.toHaveBeenCalled();
      expect(mockPrisma.warehouseStock.create).not.toHaveBeenCalled();
      expect(mockPrisma.warehouseStock.update).not.toHaveBeenCalled();
    });

    it('auto-creates a PENDING QC record when a matching template exists', async () => {
      // Catalog: item requires QC AND has a defaultQCTemplateId
      const itemRequiringQC = 'item-needs-qc-with-tpl';
      mockPrisma.inventoryItem.findMany.mockImplementationOnce(({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id: string) => ({
          id,
          isPerishable: false,
          requiresLotTracking: false,
          requiresQC: id === itemRequiringQC,
          // Direct template wins the resolution cascade
          defaultQCTemplateId: id === itemRequiringQC ? 'tpl-default-1' : null,
          categoryId: null,
        }));
      });

      await service.create(
        baseDto({
          items: [{ itemId: itemRequiringQC, receivedQty: 5, unitCost: 100 }],
        }),
        userId,
        tenantId,
      );

      // Exactly one QC record was created and linked to the GR
      expect(mockPrisma.qCRecord.create).toHaveBeenCalledTimes(1);
      const qcCall = mockPrisma.qCRecord.create.mock.calls[0][0];
      expect(qcCall.data.templateId).toBe('tpl-default-1');
      expect(qcCall.data.tenantId).toBe(tenantId);
      expect(qcCall.data.goodsReceiveId).toBeTruthy();
    });

    it('skips auto-create QC silently when no template can be resolved', async () => {
      // Item requires QC but has no defaultQCTemplateId, no ITEM-scope, no CATEGORY-scope
      const itemRequiringQC = 'item-needs-qc-no-tpl';
      mockPrisma.inventoryItem.findMany.mockImplementationOnce(({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids.map((id: string) => ({
          id,
          isPerishable: false,
          requiresLotTracking: false,
          requiresQC: id === itemRequiringQC,
          defaultQCTemplateId: null,
          categoryId: null,
        }));
      });
      // qCTemplate.findMany default mock returns [] — no template will match.

      await service.create(
        baseDto({
          items: [{ itemId: itemRequiringQC, receivedQty: 3, unitCost: 100 }],
        }),
        userId,
        tenantId,
      );

      // GR is still DRAFT, but no QC record was created
      expect(mockPrisma.goodsReceive.create.mock.calls[0][0].data.status).toBe('DRAFT');
      expect(mockPrisma.qCRecord.create).not.toHaveBeenCalled();
    });

    it('fast-paths to ACCEPTED when no item requires QC (legacy behavior preserved)', async () => {
      await service.create(
        baseDto({
          items: [{ itemId: itemNonPerishable, receivedQty: 5, unitCost: 100 }],
        }),
        userId,
        tenantId,
      );

      // Header was created as DRAFT but flipped to ACCEPTED inside _applyAcceptance
      expect(mockPrisma.goodsReceive.create.mock.calls[0][0].data.status).toBe('DRAFT');
      const calls = mockPrisma.goodsReceive.update.mock.calls.map((c: any[]) => c[0]);
      const acceptCall = calls.find((c: any) => c.data?.status === 'ACCEPTED');
      expect(acceptCall).toBeDefined();
      expect(acceptCall.data.inspectedAt).toBeInstanceOf(Date);
      expect(acceptCall.data.inspectedBy).toBe(userId);
      // Stock writes happened
      expect(mockPrisma.stockMovement.create).toHaveBeenCalled();
    });
  });

  // ─── Regression: Flow honesty — qcPending semantic ────────────────────────
  // 2026-04-25 — production users complained that the timeline UI marked
  // QC as done immediately on a freshly-created GR. The backend currently
  // creates GR with status='ACCEPTED' synchronously (see flow-debt note in
  // create()), so the only honest signal for "QC happened" is `inspectedAt`.
  // findOne must surface a derived `qcPending` flag and a `requiresQC` flag
  // computed from the items so the UI can show the pending-QC banner.
  describe('regression — qcPending honesty in findOne mapToDetail', () => {
    // Direct unit test of mapToDetail via a synthetic raw row, since wiring
    // up findOne with full Prisma mocks isn't worth it for this assertion.
    it('marks qcPending=true when an item requires QC and inspectedAt is null', () => {
      // Access the private mapper through `(service as any)`. We're calling
      // a single pure function, so test isolation is preserved.
      const detail = (service as any).mapToDetail(
        {
          id: 'gr-1',
          tenantId,
          grNumber: 'GR-X',
          purchaseOrderId: null,
          warehouseId,
          status: 'ACCEPTED',
          subtotal: 0,
          totalAmount: 0,
          notes: null,
          receivedBy: userId,
          inspectedBy: null,
          inspectedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 'gri-1',
              itemId: 'item-x',
              receivedQty: 5,
              rejectedQty: 0,
              unitCost: 10,
              item: { id: 'item-x', name: 'X', sku: 'SKU-X', unit: 'PIECE', requiresQC: true },
            },
          ],
          qcRecords: [{ id: 'qcr-1' }],
        },
        { lotMap: new Map(), userMap: new Map() },
      );

      expect(detail.requiresQC).toBe(true);
      expect(detail.qcPending).toBe(true); // status=ACCEPTED but no inspectedAt
    });

    it('marks qcPending=false when no item requires QC even if inspectedAt is null', () => {
      const detail = (service as any).mapToDetail(
        {
          id: 'gr-2',
          tenantId,
          grNumber: 'GR-Y',
          purchaseOrderId: null,
          warehouseId,
          status: 'ACCEPTED',
          subtotal: 0,
          totalAmount: 0,
          notes: null,
          receivedBy: userId,
          inspectedBy: null,
          inspectedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 'gri-1',
              itemId: 'item-y',
              receivedQty: 5,
              rejectedQty: 0,
              unitCost: 10,
              item: { id: 'item-y', name: 'Y', sku: 'SKU-Y', unit: 'PIECE', requiresQC: false },
            },
          ],
        },
        { lotMap: new Map(), userMap: new Map() },
      );

      expect(detail.requiresQC).toBe(false);
      expect(detail.qcPending).toBe(false);
    });

    it('marks qcPending=false once inspectedAt is set, regardless of requiresQC', () => {
      const detail = (service as any).mapToDetail(
        {
          id: 'gr-3',
          tenantId,
          grNumber: 'GR-Z',
          purchaseOrderId: null,
          warehouseId,
          status: 'ACCEPTED',
          subtotal: 0,
          totalAmount: 0,
          notes: null,
          receivedBy: userId,
          inspectedBy: 'inspector-1',
          inspectedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 'gri-1',
              itemId: 'item-z',
              receivedQty: 5,
              rejectedQty: 0,
              unitCost: 10,
              item: { id: 'item-z', name: 'Z', sku: 'SKU-Z', unit: 'PIECE', requiresQC: true },
            },
          ],
          qcRecords: [{ id: 'qcr-1' }],
        },
        { lotMap: new Map(), userMap: new Map() },
      );

      expect(detail.requiresQC).toBe(true);
      expect(detail.qcPending).toBe(false); // QC explicitly happened
    });
  });

  // ─── Regression: Prisma StockMovement input shape ─────────────────────────
  // 2026-04-25 — production GR submit failed with
  //   "Unknown argument `lotId`. Did you mean `lot`?"
  // because we mixed `warehouse: { connect }` (relation form) with scalar
  // `lotId: ...` in the same `data` payload, which forces Prisma to use
  // StockMovementCreateInput (relation-only). The fix is to use
  // `lot: { connect: { id } }` and only when a lot exists.
  describe('regression — stockMovement.create payload shape', () => {
    it('uses `lot: { connect }` and never sends scalar lotId (lot-tracked item)', async () => {
      await service.create(
        baseDto({
          items: [{ itemId: itemPerishable, receivedQty: 3, unitCost: 80 }],
        }),
        userId,
        tenantId,
      );

      const movement = mockPrisma.__state.stockMovements[0];
      // Must NOT have raw scalar lotId — Prisma rejects it in CreateInput mode
      expect(movement).not.toHaveProperty('lotId');
      // Must use relation form
      expect(movement.lot).toEqual({ connect: { id: expect.stringMatching(/^lot-/) } });
    });

    it('omits the lot key entirely when item has no lot tracking', async () => {
      await service.create(
        baseDto({
          items: [{ itemId: itemNonPerishable, receivedQty: 5, unitCost: 100 }],
        }),
        userId,
        tenantId,
      );

      const movement = mockPrisma.__state.stockMovements[0];
      expect(movement).not.toHaveProperty('lotId');
      expect(movement).not.toHaveProperty('lot');
    });
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
        items: [{ itemId: itemNonPerishable, receivedQty: 5, rejectedQty: 1, unitCost: 100 }],
      }),
      userId,
      tenantId,
    );

    // After DRAFT-first refactor `goodsReceive.update` is called multiple times:
    //   1. Subtotal/totalAmount persistence
    //   2. (Inside _applyAcceptance) status → ACCEPTED + inspectedAt
    // Find the call that actually carried subtotal — last call may be the
    // status flip, not the totals.
    const calls = mockPrisma.goodsReceive.update.mock.calls.map((c: any[]) => c[0]);
    const totalsCall = calls.find((c: any) => c.data?.subtotal !== undefined);
    expect(totalsCall).toBeDefined();
    // Accepted = 5 - 1 = 4 units * 100 = 400
    expect(Number(totalsCall.data.subtotal)).toBe(400);
    expect(Number(totalsCall.data.totalAmount)).toBe(400);
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
    // The GR header IS updated (status flipped to ACCEPTED by _applyAcceptance)
    // but NO subtotal write happens because computedTotal stayed at 0.
    const calls = mockPrisma.goodsReceive.update.mock.calls.map((c: any[]) => c[0]);
    expect(calls.find((c: any) => c.data?.subtotal !== undefined)).toBeUndefined();
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
    mockPrisma.warehouse.findFirst.mockResolvedValue(null);
    await expect(service.create(baseDto(), userId, tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when warehouse belongs to a different tenant', async () => {
    mockPrisma.warehouse.findFirst.mockResolvedValue({
      id: warehouseId,
      tenantId: 'other-tenant',
      name: 'x',
    });
    await expect(service.create(baseDto(), userId, tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the linked PO is missing', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
    await expect(
      service.create(baseDto({ purchaseOrderId: poId }), userId, tenantId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when PO status is DRAFT', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
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
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({
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
    // 2026-04-25 — DRAFT-first refactor moved the missing-item check to a
    // single `findMany` at the top of create() (so we can also read
    // `requiresQC` upfront). Mock both to be safe.
    mockPrisma.inventoryItem.findUnique.mockResolvedValue(null);
    mockPrisma.inventoryItem.findMany.mockResolvedValueOnce([]); // empty = nothing matched
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
      mockPrisma.goodsReceive.findFirst = jest.fn().mockResolvedValue({
        id: 'g1',
        tenantId,
        status: 'DRAFT',
      });
      await expect(service.inspect('g1', userId, tenantId, 'INSPECTING')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects when the GR belongs to another tenant', async () => {
      mockPrisma.goodsReceive.findFirst = jest.fn().mockResolvedValue({
        id: 'g1',
        tenantId: 'other',
        status: 'ACCEPTED',
      });
      await expect(service.inspect('g1', userId, tenantId, 'INSPECTING')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── บันทึกซื้อสด — the market run ────────────────────────────────────────
  describe('createCashPurchase', () => {
    const cashDto = (overrides?: Partial<CreateCashPurchaseDto>): CreateCashPurchaseDto => ({
      warehouseId,
      vendorName: 'ตลาดสดบางกะปิ',
      paymentMethod: 'OWN_MONEY' as CreateCashPurchaseDto['paymentMethod'],
      items: [{ itemId: itemNonPerishable, receivedQty: 5, unitCost: 100 }],
      ...overrides,
    });

    beforeEach(() => {
      mockPrisma.supplier = { findFirst: jest.fn().mockResolvedValue(null) };
      mockPrisma.purchaseRequisition = {
        findFirst: jest.fn().mockResolvedValue({ id: 'pr-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
    });

    it('writes stock through a receipt that has no purchase order', async () => {
      await service.createCashPurchase(cashDto(), userId, tenantId);

      expect(mockPrisma.purchaseOrder.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.__state.grInserted.purchaseOrderId).toBeUndefined();
      expect(mockPrisma.__state.grInserted.source).toBe('CASH_PURCHASE');
      // The whole point: the goods actually land on the shelf.
      expect(mockPrisma.stockMovement.create).toHaveBeenCalledTimes(1);
    });

    it('emits gr.completed so a requisition waiting on stock can wake up', async () => {
      await service.createCashPurchase(cashDto(), userId, tenantId);

      const [event, payload] = mockEventEmitter.emit.mock.calls[0];
      expect(event).toBe('gr.completed');
      // MaterialRequisitionListener keys off warehouse + items, never the PO —
      // which is exactly why a market run releases WAITING_STOCK for free.
      expect(payload.purchaseOrderId).toBeNull();
      expect(payload.warehouseId).toBe(warehouseId);
      expect(payload.items[0].itemId).toBe(itemNonPerishable);
    });

    it('records who fronted the money, not who typed the form', async () => {
      await service.createCashPurchase(cashDto({ paidBy: 'housekeeper-007' }), userId, tenantId);

      expect(mockPrisma.__state.grInserted.paidBy).toBe('housekeeper-007');
      expect(mockPrisma.__state.grInserted.paymentMethod).toBe('OWN_MONEY');
    });

    it('falls back to the recorder only when nobody else is named', async () => {
      await service.createCashPurchase(cashDto(), userId, tenantId);

      expect(mockPrisma.__state.grInserted.paidBy).toBe(userId);
    });

    /**
     * `paidBy` has no foreign key and the DTO can only promise "shaped like a
     * UUID". On OWN_MONEY it is the record of who the hotel owes money to, so
     * an ID from outside the tenant would both misdirect a reimbursement and
     * surface that user's name on the receipt.
     */
    it('refuses a payer from another tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createCashPurchase(
          cashDto({ paidBy: '11111111-2222-3333-4444-555555555555' }),
          userId,
          tenantId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.goodsReceive.create).not.toHaveBeenCalled();
    });

    it('scopes the payer lookup to this tenant', async () => {
      await service.createCashPurchase(cashDto({ paidBy: 'housekeeper-007' }), userId, tenantId);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'housekeeper-007', tenantId } }),
      );
    });

    it('skips the lookup entirely when nobody is named', async () => {
      await service.createCashPurchase(cashDto(), userId, tenantId);

      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('refuses a purchase over the ceiling instead of routing around approval', async () => {
      mockConfig.get.mockReturnValueOnce('5000');

      await expect(
        service.createCashPurchase(
          cashDto({ items: [{ itemId: itemNonPerishable, receivedQty: 100, unitCost: 100 }] }),
          userId,
          tenantId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Nothing was written — a rejected purchase must not leave stock behind.
      expect(mockPrisma.goodsReceive.create).not.toHaveBeenCalled();
    });

    it('honours a configured ceiling over the built-in default', async () => {
      mockConfig.get.mockReturnValueOnce('100');

      await expect(service.createCashPurchase(cashDto(), userId, tenantId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a receipt that can name neither a supplier nor a shop', async () => {
      await expect(
        service.createCashPurchase(cashDto({ vendorName: '   ' }), userId, tenantId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('snapshots the supplier name so a later rename cannot rewrite history', async () => {
      mockPrisma.supplier.findFirst = jest
        .fn()
        .mockResolvedValue({ id: 'sup-1', name: 'ร้านนายใหม่' });

      await service.createCashPurchase(
        cashDto({ vendorName: undefined, supplierId: 'sup-1' }),
        userId,
        tenantId,
      );

      expect(mockPrisma.__state.grInserted.vendorName).toBe('ร้านนายใหม่');
      expect(mockPrisma.__state.grInserted.supplierId).toBe('sup-1');
    });

    it("will not attach another tenant's supplier", async () => {
      mockPrisma.supplier.findFirst = jest.fn().mockResolvedValue(null);

      await expect(
        service.createCashPurchase(cashDto({ supplierId: 'sup-other' }), userId, tenantId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("will not attach another tenant's requisition", async () => {
      mockPrisma.purchaseRequisition.findFirst = jest.fn().mockResolvedValue(null);

      await expect(
        service.createCashPurchase(cashDto({ purchaseRequisitionId: 'pr-other' }), userId, tenantId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('closes the requisition only when asked to', async () => {
      await service.createCashPurchase(
        cashDto({ purchaseRequisitionId: 'pr-1' }),
        userId,
        tenantId,
      );
      expect(mockPrisma.purchaseRequisition.updateMany).not.toHaveBeenCalled();

      await service.createCashPurchase(
        cashDto({ purchaseRequisitionId: 'pr-1', closePurchaseRequisition: true }),
        userId,
        tenantId,
      );
      const { where, data } = mockPrisma.purchaseRequisition.updateMany.mock.calls[0][0];
      expect(where).toMatchObject({ id: 'pr-1', tenantId });
      expect(data.status).toBe('CLOSED');
      // A cancelled requisition must not be resurrected into CLOSED.
      expect(where.status).toEqual({ notIn: ['CANCELLED', 'CLOSED'] });
    });

    // ─── สลิป / หลักฐานการจ่ายเงิน ──────────────────────────────────────────
    describe('แนบสลิป', () => {
      const slip = (overrides?: Record<string, unknown>) => ({
        storageKey: `cash-purchase-slips/${tenantId}/slip-1-2.jpg`,
        originalName: 'IMG_2043.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 348122,
        ...overrides,
      });

      it('ผูกสลิปกับใบรับของ พร้อมบันทึกว่าใครเป็นคนแนบ', async () => {
        await service.createCashPurchase(
          cashDto({ slips: [slip()] as CreateCashPurchaseDto['slips'] }),
          userId,
          tenantId,
        );

        const [row] = mockPrisma.__state.attachmentsInserted;
        expect(mockPrisma.__state.attachmentsInserted).toHaveLength(1);
        expect(row).toMatchObject({
          tenantId,
          kind: 'SLIP',
          storageKey: `cash-purchase-slips/${tenantId}/slip-1-2.jpg`,
          originalName: 'IMG_2043.jpg',
          uploadedBy: userId,
        });
        expect(row.goodsReceiveId).toBe(mockPrisma.__state.grInserted.id);
      });

      it('ประกอบ URL เองจาก key ไม่รับ URL จาก client', async () => {
        await service.createCashPurchase(
          cashDto({
            slips: [slip({ url: 'https://evil.example.com/tracker.png' })] as any,
          }),
          userId,
          tenantId,
        );

        // ฟิลด์นี้ถูกเอาไป render เป็น <img> — ถ้าเชื่อ client ตรง ๆ ใครก็ฝัง
        // ลิงก์ภายนอกลงใน "หลักฐานการจ่ายเงิน" ได้
        expect(mockStorage.publicPath).toHaveBeenCalledWith(
          `cash-purchase-slips/${tenantId}/slip-1-2.jpg`,
        );
        expect(mockPrisma.__state.attachmentsInserted[0].url).toBe(
          `/uploads/cash-purchase-slips/${tenantId}/slip-1-2.jpg`,
        );
      });

      it('ปฏิเสธ key ที่อยู่นอกโฟลเดอร์ของ tenant ตัวเอง', async () => {
        await expect(
          service.createCashPurchase(
            cashDto({
              slips: [
                slip({ storageKey: 'cash-purchase-slips/tenant-999/slip-1-2.jpg' }),
              ] as CreateCashPurchaseDto['slips'],
            }),
            userId,
            tenantId,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        // ต้องตายก่อนเขียนอะไรลง DB — ไม่ใช่ได้ใบรับของแล้วค่อยพบว่าสลิปแปลกปลอม
        expect(mockPrisma.goodsReceive.create).not.toHaveBeenCalled();
      });

      it('ปฏิเสธ key ที่พยายามไต่ออกนอกโฟลเดอร์', async () => {
        await expect(
          service.createCashPurchase(
            cashDto({
              slips: [
                slip({ storageKey: `cash-purchase-slips/${tenantId}/../../secrets.pdf` }),
              ] as CreateCashPurchaseDto['slips'],
            }),
            userId,
            tenantId,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it('รับ PHOTO ได้ด้วย สำหรับร้านที่ไม่ออกใบเสร็จ', async () => {
        await service.createCashPurchase(
          cashDto({
            hasNoReceipt: true,
            slips: [slip({ kind: 'PHOTO' })] as CreateCashPurchaseDto['slips'],
          }),
          userId,
          tenantId,
        );

        expect(mockPrisma.__state.attachmentsInserted[0].kind).toBe('PHOTO');
        expect(mockPrisma.__state.grInserted.hasNoReceipt).toBe(true);
      });

      it('ไม่แตะตารางไฟล์แนบเลยถ้าไม่ได้แนบอะไรมา', async () => {
        await service.createCashPurchase(cashDto(), userId, tenantId);

        expect(mockPrisma.goodsReceiveAttachment.createMany).not.toHaveBeenCalled();
      });

      it('slips ไม่หลุดไปเป็นคอลัมน์ของ GoodsReceive', async () => {
        await service.createCashPurchase(
          cashDto({ slips: [slip()] as CreateCashPurchaseDto['slips'] }),
          userId,
          tenantId,
        );

        // provenance ถูก spread ลง goodsReceive.create ตรง ๆ — ถ้าลืมแยก slips ออก
        // Prisma จะโยน validation error ทั้งใบตอนรันจริง แต่ mock จะกลืนเงียบ ๆ
        expect(mockPrisma.__state.grInserted).not.toHaveProperty('slips');
      });
    });

    it('keeps the goods even if closing the requisition fails', async () => {
      mockPrisma.purchaseRequisition.updateMany = jest
        .fn()
        .mockRejectedValue(new Error('deadlock'));

      // The stock is already committed at this point; throwing here would
      // report a purchase that did happen as one that did not.
      await expect(
        service.createCashPurchase(
          cashDto({ purchaseRequisitionId: 'pr-1', closePurchaseRequisition: true }),
          userId,
          tenantId,
        ),
      ).resolves.toBeDefined();
    });
  });

  /**
   * รายชื่อคนที่เลือกเป็น "คนออกเงิน" ได้
   *
   * มีอยู่เพราะ `paidBy` เป็น user id ไม่ใช่ชื่อ — ฟอร์มจึงต้องมีรายชื่อให้เลือก
   * แต่รายชื่อผู้ใช้เป็นข้อมูลที่ไม่ควรรั่วข้าม tenant และไม่ควรกลายเป็นทะเบียนพนักงาน
   */
  describe('listCashPurchasePayers', () => {
    it('คืนเฉพาะคนใน tenant ตัวเอง และเฉพาะที่ยัง active', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([]);

      await service.listCashPurchasePayers(tenantId);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'active' } }),
      );
    });

    it('คืนแค่ id กับชื่อ ไม่ติดอีเมลหรือ role ออกไปด้วย', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'u-1', firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@hotel.test' },
      ]);

      const payers = await service.listCashPurchasePayers(tenantId);

      expect(payers).toEqual([{ id: 'u-1', name: 'สมชาย ใจดี' }]);
    });

    it('ไม่มีชื่อก็ใช้อีเมลแทน — ตัวเลือกที่ว่างเปล่าเลือกไม่ถูก', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'u-2', firstName: null, lastName: null, email: 'store@hotel.test' },
      ]);

      expect((await service.listCashPurchasePayers(tenantId))[0].name).toBe('store@hotel.test');
    });
  });

  /**
   * ชื่อที่ขึ้นบนใบรับของ
   *
   * id พวกนี้อ่านมาจากแถวที่เก็บไว้ ซึ่งไม่ใช่หลักฐานว่ามันเป็นของ tenant นี้ —
   * `paidBy` มาจาก client โดยตรง ถ้าไม่กรอง tenant ใบที่ถือ id ของ tenant อื่น
   * จะ render ชื่อและอีเมลของคนนั้นกลับมาให้คนที่เปิดดู
   */
  describe('resolveUserNames', () => {
    it('กรองด้วย tenantId เสมอ', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([]);

      await (service as any).resolveUserNames(['u-1', null, 'u-2'], tenantId);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['u-1', 'u-2'] }, tenantId } }),
      );
    });

    it('ไม่มี id ให้แปลก็ไม่ต้องยิง query', async () => {
      await (service as any).resolveUserNames([null, undefined], tenantId);

      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
