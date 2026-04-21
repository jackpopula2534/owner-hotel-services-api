import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PurchaseRequisitionsService } from '../purchase-requisitions.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('PurchaseRequisitionsService', () => {
  let service: PurchaseRequisitionsService;

  const mockTenantId = 'tenant-001';
  const mockUserId = 'user-001';
  const mockPropertyId = 'property-001';
  const mockPRId = 'pr-001';

  const mockPrismaService = {
    purchaseRequisition: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchaseRequisitionItem: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    property: {
      findUnique: jest.fn(),
    },
    inventoryItem: {
      findMany: jest.fn(),
    },
    supplier: {
      findMany: jest.fn(),
    },
    supplierQuote: {
      create: jest.fn(),
    },
    warehouse: {
      findUnique: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    purchaseOrderItem: {
      createMany: jest.fn(),
    },
    documentSequence: {
      upsert: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn(mockPrismaService)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PurchaseRequisitionsService>(
      PurchaseRequisitionsService,
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ===================== findAll =====================
  describe('findAll', () => {
    it('should return paginated purchase requisitions', async () => {
      const mockPRList = [
        {
          id: 'pr-001',
          prNumber: 'PR-202604-0001',
          status: 'DRAFT',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: 'Test purpose',
          department: 'Housekeeping',
          requiredDate: new Date('2026-05-01'),
          createdAt: new Date(),
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          _count: { items: 3, supplierQuotes: 0 },
        },
      ];

      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue(
        mockPRList,
      );
      mockPrismaService.purchaseRequisition.count.mockResolvedValue(1);

      const result = await service.findAll(mockTenantId, {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 1 });
      expect(result.data[0]).toHaveProperty('prNumber', 'PR-202604-0001');
      expect(result.data[0]).toHaveProperty('itemCount', 3);
    });

    it('should apply status filter', async () => {
      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseRequisition.count.mockResolvedValue(0);

      await service.findAll(mockTenantId, {
        page: 1,
        limit: 20,
        status: 'DRAFT' as any,
      });

      expect(
        mockPrismaService.purchaseRequisition.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: mockTenantId,
            status: 'DRAFT',
          }),
        }),
      );
    });

    it('should apply search filter on prNumber', async () => {
      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseRequisition.count.mockResolvedValue(0);

      await service.findAll(mockTenantId, {
        page: 1,
        limit: 20,
        search: 'PR-202604',
      });

      expect(
        mockPrismaService.purchaseRequisition.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            prNumber: { contains: 'PR-202604' },
          }),
        }),
      );
    });
  });

  // ===================== findOne =====================
  describe('findOne', () => {
    it('should return a single PR with items and quotes', async () => {
      const mockPR = {
        id: mockPRId,
        tenantId: mockTenantId,
        prNumber: 'PR-202604-0001',
        status: 'DRAFT',
        priority: 'HIGH',
        propertyId: mockPropertyId,
        purpose: 'Restocking',
        department: 'Kitchen',
        requiredDate: new Date('2026-05-01'),
        notes: 'Urgent',
        internalNotes: null,
        requestedBy: mockUserId,
        approvedBy: null,
        approvedAt: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'item-row-1',
            itemId: 'inv-item-1',
            item: { name: 'Towels', sku: 'TWL-001' },
            quantity: 50,
            estimatedUnitPrice: 120,
            specifications: 'White, 100% cotton',
            preferredSupplierId: null,
            notes: null,
          },
        ],
        supplierQuotes: [],
      };

      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue(
        mockPR,
      );

      const result = await service.findOne(mockPRId, mockTenantId);

      expect(result).toHaveProperty('prNumber', 'PR-202604-0001');
      expect((result as any).items).toHaveLength(1);
      expect((result as any).items[0]).toHaveProperty('itemName', 'Towels');
    });

    it('should throw NotFoundException if PR not found', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent-id', mockTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if PR belongs to different tenant', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        id: mockPRId,
        tenantId: 'other-tenant',
      });

      await expect(
        service.findOne(mockPRId, mockTenantId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ===================== create =====================
  describe('create', () => {
    const createDto = {
      propertyId: mockPropertyId,
      priority: 'HIGH' as any,
      department: 'Housekeeping',
      requiredDate: '2026-05-15',
      purpose: 'Monthly restocking',
      notes: 'Urgent',
      items: [
        {
          itemId: 'inv-item-1',
          quantity: 10,
          estimatedUnitPrice: 250,
        },
        {
          itemId: 'inv-item-2',
          quantity: 20,
          estimatedUnitPrice: 100,
          preferredSupplierId: 'supplier-1',
        },
      ],
    };

    it('should create PR with items successfully', async () => {
      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      mockPrismaService.supplier.findMany.mockResolvedValue([
        { id: 'supplier-1' },
      ]);

      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 1,
      });

      const createdPR = {
        id: 'new-pr-id',
        prNumber: 'PR-202604-0001',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(
        createdPR,
      );
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      // Mock findOne for the return value
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        ...createdPR,
        status: 'DRAFT',
        priority: 'HIGH',
        propertyId: mockPropertyId,
        purpose: 'Monthly restocking',
        department: 'Housekeeping',
        requiredDate: new Date('2026-05-15'),
        notes: 'Urgent',
        internalNotes: null,
        requestedBy: mockUserId,
        approvedBy: null,
        approvedAt: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [
          {
            id: 'row-1',
            itemId: 'inv-item-1',
            item: { name: 'Towels', sku: 'TWL-001' },
            quantity: 10,
            estimatedUnitPrice: 250,
            specifications: null,
            preferredSupplierId: null,
            notes: null,
          },
          {
            id: 'row-2',
            itemId: 'inv-item-2',
            item: { name: 'Soap', sku: 'SOP-001' },
            quantity: 20,
            estimatedUnitPrice: 100,
            specifications: null,
            preferredSupplierId: 'supplier-1',
            notes: null,
          },
        ],
        supplierQuotes: [],
      });

      const result = await service.create(createDto, mockUserId, mockTenantId);

      expect(result).toHaveProperty('prNumber', 'PR-202604-0001');
      expect((result as any).items).toHaveLength(2);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException if property not found', async () => {
      mockPrismaService.property.findUnique.mockResolvedValue(null);

      await expect(
        service.create(createDto, mockUserId, mockTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if inventory items not found', async () => {
      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      // Return only 1 item when 2 are expected
      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
      ]);

      await expect(
        service.create(createDto, mockUserId, mockTenantId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if preferred supplier not found', async () => {
      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      // Return empty suppliers
      mockPrismaService.supplier.findMany.mockResolvedValue([]);

      await expect(
        service.create(createDto, mockUserId, mockTenantId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ===================== update =====================
  describe('update', () => {
    it('should update a DRAFT PR successfully', async () => {
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'DRAFT',
          priority: 'URGENT',
          propertyId: mockPropertyId,
          purpose: 'Updated purpose',
          department: 'Kitchen',
          requiredDate: new Date('2026-05-20'),
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
      });

      const result = await service.update(
        mockPRId,
        {
          priority: 'URGENT' as any,
          purpose: 'Updated purpose',
          department: 'Kitchen',
        },
        mockTenantId,
      );

      expect(result).toHaveProperty('priority', 'URGENT');
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should reject update on APPROVED status PR', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'APPROVED',
      });

      await expect(
        service.update(
          mockPRId,
          { purpose: 'Should fail' },
          mockTenantId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replace items when items array is provided', async () => {
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'DRAFT',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [
            {
              id: 'new-row-1',
              itemId: 'inv-item-3',
              item: { name: 'Shampoo', sku: 'SHP-001' },
              quantity: 100,
              estimatedUnitPrice: 50,
              specifications: null,
              preferredSupplierId: null,
              notes: null,
            },
          ],
          supplierQuotes: [],
        });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-3' },
      ]);
      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
      });
      mockPrismaService.purchaseRequisitionItem.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.update(
        mockPRId,
        {
          items: [{ itemId: 'inv-item-3', quantity: 100, estimatedUnitPrice: 50 }],
        },
        mockTenantId,
      );

      expect(
        mockPrismaService.purchaseRequisitionItem.deleteMany,
      ).toHaveBeenCalledWith({
        where: { purchaseRequisitionId: mockPRId },
      });
      expect(
        mockPrismaService.purchaseRequisitionItem.createMany,
      ).toHaveBeenCalled();
    });
  });

  // ===================== submit =====================
  describe('submit', () => {
    it('should change DRAFT to PENDING_APPROVAL', async () => {
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'PENDING_APPROVAL',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const result = await service.submit(mockPRId, mockTenantId);
      expect((result as any).status).toBe('PENDING_APPROVAL');
    });

    it('should reject submit if not in DRAFT status', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'APPROVED',
      });

      await expect(
        service.submit(mockPRId, mockTenantId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===================== approve =====================
  describe('approve', () => {
    it('should change PENDING_APPROVAL to APPROVED', async () => {
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'PENDING_APPROVAL',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'APPROVED',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: mockUserId,
          approvedAt: new Date(),
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const result = await service.approve(
        mockPRId,
        mockUserId,
        mockTenantId,
      );
      expect((result as any).status).toBe('APPROVED');
      expect((result as any).approvedBy).toBe(mockUserId);
    });

    it('should reject approve if not in PENDING_APPROVAL status', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'DRAFT',
      });

      await expect(
        service.approve(mockPRId, mockUserId, mockTenantId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===================== cancel =====================
  describe('cancel', () => {
    it('should cancel a PR with reason', async () => {
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'CANCELLED',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          cancelReason: 'Budget cut',
          cancelledBy: mockUserId,
          cancelledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const result = await service.cancel(
        mockPRId,
        'Budget cut',
        mockUserId,
        mockTenantId,
      );
      expect((result as any).status).toBe('CANCELLED');
      expect((result as any).cancelReason).toBe('Budget cut');
    });

    it('should reject cancel if PO already created', async () => {
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'PO_CREATED',
      });

      await expect(
        service.cancel(mockPRId, 'Too late', mockUserId, mockTenantId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===================== Edge Cases =====================
  describe('edge cases', () => {
    it('should ignore empty-string preferredSupplierId during create', async () => {
      const dto = {
        propertyId: mockPropertyId,
        items: [
          {
            itemId: 'inv-item-1',
            quantity: 5,
            preferredSupplierId: '',
          },
          {
            itemId: 'inv-item-2',
            quantity: 10,
            preferredSupplierId: undefined,
          },
        ],
      };

      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 2,
      });

      const createdPR = {
        id: 'new-pr-edge',
        prNumber: 'PR-202604-0002',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(
        createdPR,
      );
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        ...createdPR,
        status: 'DRAFT',
        priority: 'NORMAL',
        propertyId: mockPropertyId,
        purpose: null,
        department: null,
        requiredDate: null,
        notes: null,
        internalNotes: null,
        requestedBy: mockUserId,
        approvedBy: null,
        approvedAt: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        supplierQuotes: [],
      });

      // Should NOT call supplier.findMany since all preferred IDs are empty/undefined
      const result = await service.create(dto as any, mockUserId, mockTenantId);

      expect(mockPrismaService.supplier.findMany).not.toHaveBeenCalled();
      expect(result).toHaveProperty('prNumber', 'PR-202604-0002');
    });

    it('should deduplicate preferredSupplierIds during validation', async () => {
      const dto = {
        propertyId: mockPropertyId,
        items: [
          {
            itemId: 'inv-item-1',
            quantity: 5,
            preferredSupplierId: 'supplier-1',
          },
          {
            itemId: 'inv-item-2',
            quantity: 10,
            preferredSupplierId: 'supplier-1',
          },
        ],
      };

      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      mockPrismaService.supplier.findMany.mockResolvedValue([
        { id: 'supplier-1' },
      ]);

      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 3,
      });

      const createdPR = {
        id: 'new-pr-dedup',
        prNumber: 'PR-202604-0003',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(
        createdPR,
      );
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        ...createdPR,
        status: 'DRAFT',
        priority: 'NORMAL',
        propertyId: mockPropertyId,
        purpose: null,
        department: null,
        requiredDate: null,
        notes: null,
        internalNotes: null,
        requestedBy: mockUserId,
        approvedBy: null,
        approvedAt: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        supplierQuotes: [],
      });

      const result = await service.create(dto as any, mockUserId, mockTenantId);

      // Should query with deduplicated array (1 unique ID, not 2)
      expect(mockPrismaService.supplier.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['supplier-1'] }, tenantId: mockTenantId },
        select: { id: true },
      });
      expect(result).toHaveProperty('prNumber', 'PR-202604-0003');
    });

    it('should handle create without optional fields', async () => {
      const minimalDto = {
        propertyId: mockPropertyId,
        items: [{ itemId: 'inv-item-1', quantity: 1 }],
      };

      mockPrismaService.property.findUnique.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });
      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
      ]);
      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 4,
      });

      const createdPR = {
        id: 'minimal-pr',
        prNumber: 'PR-202604-0004',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(
        createdPR,
      );
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseRequisition.findUnique.mockResolvedValue({
        ...createdPR,
        status: 'DRAFT',
        priority: 'NORMAL',
        propertyId: mockPropertyId,
        purpose: null,
        department: null,
        requiredDate: null,
        notes: null,
        internalNotes: null,
        requestedBy: mockUserId,
        approvedBy: null,
        approvedAt: null,
        cancelReason: null,
        cancelledBy: null,
        cancelledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        supplierQuotes: [],
      });

      const result = await service.create(
        minimalDto as any,
        mockUserId,
        mockTenantId,
      );
      expect(result).toHaveProperty('status', 'DRAFT');
    });
  });

  // ===================== Full Lifecycle =====================
  describe('full lifecycle: DRAFT → PENDING_APPROVAL → APPROVED → cancel', () => {
    it('should progress through status transitions correctly', async () => {
      // Step 1: Submit (DRAFT → PENDING_APPROVAL)
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'DRAFT',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'PENDING_APPROVAL',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const submitted = await service.submit(mockPRId, mockTenantId);
      expect((submitted as any).status).toBe('PENDING_APPROVAL');

      // Step 2: Approve (PENDING_APPROVAL → APPROVED)
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'PENDING_APPROVAL',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'APPROVED',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: mockUserId,
          approvedAt: new Date(),
          cancelReason: null,
          cancelledBy: null,
          cancelledAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const approved = await service.approve(
        mockPRId,
        mockUserId,
        mockTenantId,
      );
      expect((approved as any).status).toBe('APPROVED');
      expect((approved as any).approvedBy).toBe(mockUserId);

      // Step 3: Cancel (APPROVED → CANCELLED)
      mockPrismaService.purchaseRequisition.findUnique
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          status: 'APPROVED',
        })
        .mockResolvedValueOnce({
          id: mockPRId,
          tenantId: mockTenantId,
          prNumber: 'PR-202604-0001',
          status: 'CANCELLED',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          purpose: null,
          department: null,
          requiredDate: null,
          notes: null,
          internalNotes: null,
          requestedBy: mockUserId,
          approvedBy: mockUserId,
          approvedAt: new Date(),
          cancelReason: 'No longer needed',
          cancelledBy: mockUserId,
          cancelledAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          items: [],
          supplierQuotes: [],
        });

      mockPrismaService.purchaseRequisition.update.mockResolvedValue({
        id: mockPRId,
        prNumber: 'PR-202604-0001',
      });

      const cancelled = await service.cancel(
        mockPRId,
        'No longer needed',
        mockUserId,
        mockTenantId,
      );
      expect((cancelled as any).status).toBe('CANCELLED');
      expect((cancelled as any).cancelReason).toBe('No longer needed');
    });
  });
});
