import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@/prisma/prisma.service';
import { ProductChangeRequestsService } from '../product-change-requests.service';
import { ProductChangeApplyService } from '../product-change-apply.service';
import { ProductChangeQueriesService } from '../product-change-queries.service';
import { ProductChangeNotifierService } from '../product-change-notifier.service';
import { ProcurementSnapshot, buildChanges } from '../product-change-fields';

const tenantId = 'tenant-1';
const buyer = { userId: 'buyer-1', tenantId, role: 'buyer' };
const whManager = { userId: 'wh-1', tenantId, role: 'warehouse_manager' };

const snapshot: ProcurementSnapshot = {
  name: 'น้ำดื่ม 600ml',
  description: null,
  brand: null,
  preferredSupplierId: 'sup-1',
  unitPrice: 156,
  minOrderQty: 10,
  leadDays: 3,
  purchaseUnit: 'BOX',
  purchaseUnitFactor: 24,
};

function buildPrisma() {
  const prisma = {
    productChangeRequest: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    productChangeRequestEvent: { create: jest.fn() },
    documentSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 7 }) },
    inventoryItem: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
}

describe('ProductChangeRequestsService', () => {
  let service: ProductChangeRequestsService;
  let prisma: ReturnType<typeof buildPrisma>;
  const applier = {
    readSnapshot: jest.fn(),
    assertSupplier: jest.fn(),
    assertCategory: jest.fn(),
    applyUpdate: jest.fn(),
    applyCreate: jest.fn(),
  };
  const queries = { findOne: jest.fn().mockResolvedValue({ id: 'req-1' }) };
  const notifier = {
    nameOf: jest.fn().mockResolvedValue('Tester'),
    notifyReviewers: jest.fn(),
    notifyRequester: jest.fn(),
    audit: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();
    applier.readSnapshot.mockResolvedValue(snapshot);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductChangeRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProductChangeApplyService, useValue: applier },
        { provide: ProductChangeQueriesService, useValue: queries },
        { provide: ProductChangeNotifierService, useValue: notifier },
      ],
    }).compile();
    service = module.get(ProductChangeRequestsService);
  });

  describe('submitItemUpdate', () => {
    it('rejects a request that changes nothing', async () => {
      await expect(
        service.submitItemUpdate(buyer, {
          itemId: 'item-1',
          changes: { unitPrice: 156 },
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.productChangeRequest.create).not.toHaveBeenCalled();
    });

    it('refuses a second open update for the same item', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        requestNumber: 'PCR-202610-0001',
      });
      await expect(
        service.submitItemUpdate(buyer, {
          itemId: 'item-1',
          changes: { unitPrice: 168 },
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('stores the diff, baseline and APPROVAL level when the conversion changes', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue(null);
      prisma.productChangeRequest.create.mockImplementation(({ data }) => ({
        id: 'req-1',
        ...data,
      }));

      await service.submitItemUpdate(buyer, {
        itemId: 'item-1',
        changes: { unitPrice: 168, purchaseUnitFactor: 12 },
        reason: 'Supplier ขึ้นราคา',
        effectiveDate: '2026-11-01',
      });

      const data = prisma.productChangeRequest.create.mock.calls[0][0].data;
      expect(data.requestNumber).toMatch(/^PCR-\d{6}-0007$/);
      expect(data.type).toBe('UPDATE');
      expect(data.level).toBe('APPROVAL');
      expect(data.baseline).toEqual(snapshot);
      expect(data.changes.map((c: { field: string }) => c.field)).toEqual([
        'unitPrice',
        'purchaseUnitFactor',
      ]);
      expect(prisma.productChangeRequestEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'SUBMITTED' }) }),
      );
      expect(notifier.notifyReviewers).toHaveBeenCalled();
    });

    it('does not let warehouse-only roles submit', async () => {
      await expect(
        service.submitItemUpdate(
          { userId: 'c', tenantId, role: 'inventory_clerk' },
          { itemId: 'item-1', changes: { unitPrice: 1 }, reason: 'x' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('submitNewItem', () => {
    it('requires a supplier when a price is given', async () => {
      await expect(
        service.submitNewItem(buyer, { proposal: { name: 'น้ำแร่', unitPrice: 132 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates an APPROVAL-level CREATE request', async () => {
      prisma.productChangeRequest.create.mockImplementation(({ data }) => ({
        id: 'req-2',
        ...data,
      }));
      await service.submitNewItem(buyer, {
        proposal: { name: 'น้ำแร่ 500ml', supplierId: 'sup-1', unitPrice: 132 },
        suggestedWarehouse: { minStock: 48, maxStock: 240 },
      });
      const data = prisma.productChangeRequest.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ type: 'CREATE', level: 'APPROVAL', status: 'PENDING' });
      expect(applier.assertSupplier).toHaveBeenCalledWith(tenantId, 'sup-1');
    });
  });

  describe('approve', () => {
    const pendingUpdate = {
      id: 'req-1',
      tenantId,
      requestNumber: 'PCR-202610-0013',
      type: 'UPDATE',
      status: 'PENDING',
      level: 'ACKNOWLEDGE',
      itemId: 'item-1',
      requestedById: 'buyer-1',
      effectiveDate: null,
      changes: buildChanges(snapshot, { unitPrice: 168, leadDays: 5 }),
      proposed: {},
    };

    it('applies only the approved fields and marks ACKNOWLEDGED', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue(pendingUpdate);
      prisma.productChangeRequest.update.mockImplementation(({ data }) => ({
        ...pendingUpdate,
        ...data,
      }));

      await service.approve(whManager, 'req-1', { approvedFields: ['leadDays'] });

      const applied = applier.applyUpdate.mock.calls[0][3];
      expect(applied.find((c: { field: string }) => c.field === 'leadDays').decision).toBe(
        'APPROVED',
      );
      expect(applied.find((c: { field: string }) => c.field === 'unitPrice').decision).toBe(
        'REJECTED',
      );
      const data = prisma.productChangeRequest.update.mock.calls[0][0].data;
      expect(data.status).toBe('ACKNOWLEDGED');
      expect(data.appliedAt).toBeInstanceOf(Date);
    });

    it('defers applying when the effective date is in the future', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        ...pendingUpdate,
        level: 'APPROVAL',
        effectiveDate: new Date(Date.now() + 86_400_000),
      });
      prisma.productChangeRequest.update.mockImplementation(({ data }) => ({
        ...pendingUpdate,
        ...data,
      }));

      await service.approve(whManager, 'req-1', {});

      expect(applier.applyUpdate).not.toHaveBeenCalled();
      const data = prisma.productChangeRequest.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'APPROVED', appliedAt: null });
    });

    it('requires warehouse data to approve a CREATE request', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        ...pendingUpdate,
        type: 'CREATE',
        itemId: null,
      });
      await expect(service.approve(whManager, 'req-1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates the item and links it on CREATE approval', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        ...pendingUpdate,
        type: 'CREATE',
        itemId: null,
        proposed: { name: 'น้ำแร่ 500ml' },
      });
      prisma.productChangeRequest.update.mockImplementation(({ data }) => ({
        ...pendingUpdate,
        ...data,
      }));
      applier.applyCreate.mockResolvedValue('new-item');

      await service.approve(whManager, 'req-1', {
        warehouseData: { sku: 'RT-MINERAL-500', unit: 'BOTTLE' },
      });

      const data = prisma.productChangeRequest.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'APPROVED', itemId: 'new-item' });
      expect(notifier.notifyRequester).toHaveBeenCalled();
    });

    it('forbids procurement from approving', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue(pendingUpdate);
      await expect(
        service.approve({ userId: 'pm', tenantId, role: 'procurement_manager' }, 'req-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a warehouse manager from approving their own request', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        ...pendingUpdate,
        requestedById: 'wh-1',
      });
      await expect(service.approve(whManager, 'req-1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to approve a request that is waiting for more info', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        ...pendingUpdate,
        status: 'NEEDS_INFO',
      });
      await expect(service.approve(whManager, 'req-1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('requestInfo / cancel', () => {
    it('sends the request back to procurement with the note', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        tenantId,
        status: 'PENDING',
        requestedById: 'buyer-1',
      });
      prisma.productChangeRequest.update.mockImplementation(({ data }) => ({
        id: 'req-1',
        tenantId,
        ...data,
      }));
      await service.requestInfo(whManager, 'req-1', { note: 'ขอรูปสินค้า' });
      expect(prisma.productChangeRequest.update.mock.calls[0][0].data).toMatchObject({
        status: 'NEEDS_INFO',
        reviewNote: 'ขอรูปสินค้า',
      });
    });

    it('lets only the requester cancel', async () => {
      prisma.productChangeRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        tenantId,
        status: 'PENDING',
        requestedById: 'someone-else',
      });
      await expect(service.cancel(buyer, 'req-1', {})).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('applyDueUpdates', () => {
    it('applies scheduled updates and keeps going when one fails', async () => {
      prisma.productChangeRequest.findMany.mockResolvedValue([
        { id: 'a', tenantId, itemId: 'i1', requestNumber: 'A', changes: [] },
        { id: 'b', tenantId, itemId: 'i2', requestNumber: 'B', changes: [] },
      ]);
      applier.applyUpdate.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
      prisma.productChangeRequest.update.mockResolvedValue({ id: 'b', tenantId });
      await expect(service.applyDueUpdates(new Date())).resolves.toBe(1);
    });
  });
});
