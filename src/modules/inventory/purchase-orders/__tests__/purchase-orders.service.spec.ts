import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { PrismaService } from '@/prisma/prisma.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';

describe('PurchaseOrdersService — discount mode & breakdown', () => {
  let service: PurchaseOrdersService;

  const tenantId = 'tenant-001';
  const userId = 'user-001';
  const propertyId = 'property-001';
  const supplierId = 'supplier-001';
  const warehouseId = 'wh-001';
  const itemId1 = 'item-001';
  const itemId2 = 'item-002';
  const newPoId = 'po-001';

  const createdPoRow = {
    id: newPoId,
    tenantId,
    propertyId,
    poNumber: 'PO-202604-0001',
    supplierId,
    warehouseId,
    status: 'DRAFT',
    orderDate: new Date(),
    expectedDate: null,
    subtotal: 58396.8,
    taxAmount: 4052.27,
    discountAmount: 507.25,
    discountMode: 'BEFORE_VAT',
    headerDiscount: 497.25,
    headerDiscountType: 'AMOUNT',
    calculationBreakdown: null,
    totalAmount: 61941.82,
    currency: 'THB',
    notes: null,
    internalNotes: null,
    requestedBy: userId,
    approvedBy: null,
    approvedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    quotationNumber: null,
    quotationDate: null,
    purchaseRequisitionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    supplier: {
      id: supplierId,
      name: 'Test Supplier',
      code: 'SUP-001',
      contactPerson: null,
      email: null,
      phone: null,
      address: null,
      taxId: null,
      paymentTerms: null,
    },
    items: [],
    goodsReceives: [],
  };

  const mockPrismaService = {
    purchaseOrder: {
      create: jest.fn().mockResolvedValue({ id: newPoId, poNumber: 'PO-202604-0001' }),
      findUnique: jest.fn().mockResolvedValue(createdPoRow),
      update: jest.fn(),
    },
    purchaseOrderItem: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    property: {
      findUnique: jest.fn().mockResolvedValue({ id: propertyId, tenantId }),
      findFirst: jest.fn().mockResolvedValue({ id: propertyId }),
    },
    supplier: {
      findUnique: jest.fn().mockResolvedValue({ id: supplierId, tenantId }),
    },
    warehouse: {
      findUnique: jest.fn().mockResolvedValue({ id: warehouseId, tenantId }),
    },
    inventoryItem: {
      // Default: return one row per queried id so `existingItems.length === itemIds.length`.
      // Individual tests can override via mockResolvedValueOnce.
      findMany: jest.fn().mockImplementation((args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        return Promise.resolve(ids.map((id) => ({ id })));
      }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    purchaseRequisition: {
      update: jest.fn(),
    },
    documentSequence: {
      upsert: jest.fn().mockResolvedValue({ lastNumber: 1 }),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);

    jest.clearAllMocks();
    mockPrismaService.purchaseOrder.findUnique.mockResolvedValue(createdPoRow);
    mockPrismaService.purchaseOrder.create.mockResolvedValue({
      id: newPoId,
      poNumber: 'PO-202604-0001',
    });
    mockPrismaService.inventoryItem.findMany.mockImplementation(
      (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        return Promise.resolve(ids.map((id) => ({ id })));
      },
    );
    mockPrismaService.property.findUnique.mockResolvedValue({ id: propertyId, tenantId });
    mockPrismaService.property.findFirst.mockResolvedValue({ id: propertyId });
    mockPrismaService.supplier.findUnique.mockResolvedValue({ id: supplierId, tenantId });
    mockPrismaService.warehouse.findUnique.mockResolvedValue({ id: warehouseId, tenantId });
    mockPrismaService.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
    mockPrismaService.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockPrismaService),
    );
  });

  describe('create', () => {
    it('persists calculation breakdown JSON and discount fields', async () => {
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        discountMode: 'BEFORE_VAT',
        headerDiscount: 497.25,
        headerDiscountType: 'AMOUNT',
        items: [
          { itemId: itemId1, quantity: 28, unitPrice: 1904.44, taxRate: 7 },
          {
            itemId: itemId2,
            quantity: 8,
            unitPrice: 634.06,
            discount: 10,
            discountType: 'AMOUNT',
            taxRate: 7,
          },
        ],
      };

      await service.create(dto, userId, tenantId);

      const createArgs = mockPrismaService.purchaseOrder.create.mock.calls[0][0];
      const data = createArgs.data;

      expect(data.subtotal).toBe(58396.8);
      expect(data.taxAmount).toBeCloseTo(4052.27, 1);
      expect(data.totalAmount).toBeCloseTo(61941.82, 1);
      expect(data.discountMode).toBe('BEFORE_VAT');
      expect(data.headerDiscount).toBe(497.25);
      expect(data.headerDiscountType).toBe('AMOUNT');
      expect(data.discountAmount).toBeCloseTo(507.25, 2);

      // Breakdown is persisted as JSON
      const breakdown = data.calculationBreakdown;
      expect(breakdown).toBeDefined();
      expect(breakdown.subtotal).toBe(58396.8);
      expect(breakdown.totalLineDiscount).toBe(10);
      expect(breakdown.headerDiscountAmount).toBe(497.25);
      expect(breakdown.vatBase).toBeCloseTo(57889.55, 1);
      expect(breakdown.discountMode).toBe('BEFORE_VAT');
      expect(breakdown.lines).toHaveLength(2);
    });

    it('defaults to BEFORE_VAT and AMOUNT header discount when not specified', async () => {
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        items: [{ itemId: itemId1, quantity: 1, unitPrice: 100, taxRate: 7 }],
      };

      await service.create(dto, userId, tenantId);

      const data = mockPrismaService.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.discountMode).toBe('BEFORE_VAT');
      expect(data.headerDiscountType).toBe('AMOUNT');
      expect(data.headerDiscount).toBe(0);
    });

    it('supports AFTER_VAT mode', async () => {
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        discountMode: 'AFTER_VAT',
        headerDiscount: 100,
        headerDiscountType: 'AMOUNT',
        items: [{ itemId: itemId1, quantity: 1, unitPrice: 1000, taxRate: 7 }],
      };

      await service.create(dto, userId, tenantId);

      const data = mockPrismaService.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.discountMode).toBe('AFTER_VAT');
      expect(data.calculationBreakdown.discountMode).toBe('AFTER_VAT');
      expect(data.calculationBreakdown.vatBase).toBe(1000);
    });

    it('persists line discountType when creating items', async () => {
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        items: [
          {
            itemId: itemId1,
            quantity: 1,
            unitPrice: 100,
            discount: 5,
            discountType: 'AMOUNT',
            taxRate: 7,
          },
        ],
      };

      await service.create(dto, userId, tenantId);

      const itemCall = mockPrismaService.purchaseOrderItem.createMany.mock.calls[0][0];
      expect(itemCall.data[0].discountType).toBe('AMOUNT');
      expect(itemCall.data[0].discount).toBe(5);
    });

    it('rejects when items do not exist', async () => {
      mockPrismaService.inventoryItem.findMany.mockResolvedValueOnce([]);
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        items: [{ itemId: 'missing', quantity: 1, unitPrice: 10 }],
      };
      await expect(service.create(dto, userId, tenantId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('snapshots paymentTerms from DTO and deliveryAddress as-is', async () => {
      mockPrismaService.supplier.findUnique.mockResolvedValueOnce({
        id: supplierId,
        tenantId,
        paymentTerms: 'NET 30',
      });
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        paymentTerms: 'COD',
        deliveryAddress: '99/9 ถนนราชดำริ',
        items: [{ itemId: itemId1, quantity: 1, unitPrice: 100 }],
      };

      await service.create(dto, userId, tenantId);

      const data = mockPrismaService.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.paymentTerms).toBe('COD');
      expect(data.deliveryAddress).toBe('99/9 ถนนราชดำริ');
    });

    it('falls back to supplier.paymentTerms when DTO omits it', async () => {
      mockPrismaService.supplier.findUnique.mockResolvedValueOnce({
        id: supplierId,
        tenantId,
        paymentTerms: 'NET 30',
      });
      const dto: CreatePurchaseOrderDto = {
        propertyId,
        supplierId,
        warehouseId,
        items: [{ itemId: itemId1, quantity: 1, unitPrice: 100 }],
      };

      await service.create(dto, userId, tenantId);

      const data = mockPrismaService.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.paymentTerms).toBe('NET 30');
      expect(data.deliveryAddress).toBeNull();
    });
  });
});
