import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PurchaseOrdersService } from '../modules/inventory/purchase-orders/purchase-orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from '../modules/inventory/purchase-orders/dto/create-purchase-order.dto';

describe('PO creation -> price comparison approval gate (integration)', () => {
  let service: PurchaseOrdersService;

  const tenantId = 'tenant-001';
  const userId = 'user-buyer';
  const propertyId = 'property-001';
  const supplierId = 'supplier-001';
  const warehouseId = 'wh-001';
  const itemId = 'item-001';
  const prId = 'pr-001';
  const newPoId = 'po-001';

  const buildDto = (): CreatePurchaseOrderDto => ({
    propertyId,
    supplierId,
    warehouseId,
    purchaseRequisitionId: prId,
    items: [
      {
        itemId,
        quantity: 10,
        unitPrice: 100,
        taxRate: 7,
      },
    ],
  });

  const mockPrismaService = {
    purchaseOrder: {
      create: jest.fn().mockResolvedValue({ id: newPoId, poNumber: 'PO-202604-0001' }),
      findUnique: jest.fn().mockResolvedValue({
        id: newPoId,
        tenantId,
        poNumber: 'PO-202604-0001',
        status: 'DRAFT',
        subtotal: 1000,
        taxAmount: 70,
        discountAmount: 0,
        discountMode: 'BEFORE_VAT',
        headerDiscount: 0,
        headerDiscountType: 'AMOUNT',
        calculationBreakdown: null,
        totalAmount: 1070,
        currency: 'THB',
        paymentTerms: null,
        deliveryAddress: null,
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
        purchaseRequisitionId: prId,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplier: { id: supplierId, name: 'Test', code: 'SUP-001' },
        items: [],
        goodsReceives: [],
      }),
    },
    purchaseOrderItem: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    priceComparison: {
      findUnique: jest.fn(),
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

    mockPrismaService.property.findUnique.mockResolvedValue({
      id: propertyId,
      tenantId,
    });
    mockPrismaService.property.findFirst.mockResolvedValue({ id: propertyId });
    mockPrismaService.supplier.findUnique.mockResolvedValue({
      id: supplierId,
      tenantId,
    });
    mockPrismaService.warehouse.findUnique.mockResolvedValue({
      id: warehouseId,
      tenantId,
    });
    mockPrismaService.inventoryItem.findMany.mockImplementation(
      (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        return Promise.resolve(ids.map((id) => ({ id })));
      },
    );
    mockPrismaService.documentSequence.upsert.mockResolvedValue({
      lastNumber: 1,
    });
    mockPrismaService.purchaseOrder.create.mockResolvedValue({
      id: newPoId,
      poNumber: 'PO-202604-0001',
    });
    mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
      id: newPoId,
      tenantId,
      poNumber: 'PO-202604-0001',
      status: 'DRAFT',
      subtotal: 1000,
      taxAmount: 70,
      discountAmount: 0,
      discountMode: 'BEFORE_VAT',
      headerDiscount: 0,
      headerDiscountType: 'AMOUNT',
      calculationBreakdown: null,
      totalAmount: 1070,
      currency: 'THB',
      paymentTerms: null,
      deliveryAddress: null,
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
      purchaseRequisitionId: prId,
      createdAt: new Date(),
      updatedAt: new Date(),
      supplier: { id: supplierId, name: 'Test', code: 'SUP-001' },
      items: [],
      goodsReceives: [],
    });
    mockPrismaService.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockPrismaService),
    );
  });

  it('rejects PO creation when comparison is PENDING_APPROVAL (returns ConflictException)', async () => {
    mockPrismaService.priceComparison.findUnique.mockResolvedValue({
      id: 'pc-1',
      tenantId,
      purchaseRequisitionId: prId,
      status: 'PENDING_APPROVAL',
    });

    await expect(service.create(buildDto(), userId, tenantId)).rejects.toThrow(ConflictException);
    expect(mockPrismaService.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('rejects PO creation when comparison is REJECTED', async () => {
    mockPrismaService.priceComparison.findUnique.mockResolvedValue({
      id: 'pc-1',
      tenantId,
      purchaseRequisitionId: prId,
      status: 'REJECTED',
    });

    await expect(service.create(buildDto(), userId, tenantId)).rejects.toThrow(ConflictException);
  });

  it('allows PO creation when comparison is APPROVED', async () => {
    mockPrismaService.priceComparison.findUnique.mockResolvedValue({
      id: 'pc-1',
      tenantId,
      purchaseRequisitionId: prId,
      status: 'APPROVED',
    });

    await expect(service.create(buildDto(), userId, tenantId)).resolves.toBeDefined();
    expect(mockPrismaService.purchaseOrder.create).toHaveBeenCalled();
  });

  it('allows PO creation for a PR that has no comparison (direct PO)', async () => {
    mockPrismaService.priceComparison.findUnique.mockResolvedValue(null);

    await expect(service.create(buildDto(), userId, tenantId)).resolves.toBeDefined();
    expect(mockPrismaService.purchaseOrder.create).toHaveBeenCalled();
  });
});
