import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PurchaseRequisitionsService } from '../purchase-requisitions.service';
import { PrismaService } from '@/prisma/prisma.service';
import { withPrismaFallback } from '@/common/test';

describe('PurchaseRequisitionsService', () => {
  let service: PurchaseRequisitionsService;

  const mockTenantId = 'tenant-001';
  const mockUserId = 'user-001';
  const mockPropertyId = 'property-001';
  const mockPRId = 'pr-001';

  const mockPrismaService = withPrismaFallback({
    purchaseRequisition: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchaseRequisitionItem: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    // ต้องประกาศเอง ไม่ปล่อยให้ fallback สร้างให้ เพราะ fallback คืน type จริงของ
    // Prisma ทำให้เรียก .mockResolvedValue() ไม่ได้ตอน typecheck
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    property: {
      findFirst: jest.fn(),
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
      findFirst: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    purchaseOrderItem: {
      createMany: jest.fn(),
    },
    documentSequence: {
      upsert: jest.fn(),
    },
  });

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

    service = module.get<PurchaseRequisitionsService>(PurchaseRequisitionsService);

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

      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue(mockPRList);
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

      expect(mockPrismaService.purchaseRequisition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: mockTenantId,
            status: 'DRAFT',
          }),
        }),
      );
    });

    it('บอกหน้ารายการว่าใบไหนปิดเพราะไปซื้อเอง — CLOSED เฉย ๆ แยกจากใบที่ปิดทิ้งไม่ออก', async () => {
      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue([
        {
          id: 'pr-001',
          prNumber: 'PR-202608-0001',
          status: 'CLOSED',
          priority: 'NORMAL',
          propertyId: mockPropertyId,
          requiredDate: null,
          createdAt: new Date(),
          requestedBy: mockUserId,
          approvedBy: null,
          approvedAt: null,
          goodsReceives: [{ id: 'gr-1' }, { id: 'gr-2' }],
          _count: { items: 11, supplierQuotes: 0 },
        },
      ]);
      mockPrismaService.purchaseRequisition.count.mockResolvedValue(1);

      const result = await service.findAll(mockTenantId, { page: 1, limit: 20 });

      expect((result.data[0] as any).cashPurchaseCount).toBe(2);
      // นับเฉพาะใบซื้อสดของ tenant นี้ — ใบรับของถือ tenantId ของตัวเอง
      const select = mockPrismaService.purchaseRequisition.findMany.mock.calls[0][0]
        .select as any;
      expect(select.goodsReceives.where).toEqual({
        tenantId: mockTenantId,
        source: 'CASH_PURCHASE',
      });
    });

    it('should apply search filter on prNumber', async () => {
      mockPrismaService.purchaseRequisition.findMany.mockResolvedValue([]);
      mockPrismaService.purchaseRequisition.count.mockResolvedValue(0);

      await service.findAll(mockTenantId, {
        page: 1,
        limit: 20,
        search: 'PR-202604',
      });

      expect(mockPrismaService.purchaseRequisition.findMany).toHaveBeenCalledWith(
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

      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(mockPR);

      const result = await service.findOne(mockPRId, mockTenantId);

      expect(result).toHaveProperty('prNumber', 'PR-202604-0001');
      expect((result as any).items).toHaveLength(1);
      expect((result as any).items[0]).toHaveProperty('itemName', 'Towels');
    });

    it('should surface the material requisitions waiting on this PR', async () => {
      // Without this the link only runs one way: the kitchen can see the PR it
      // is waiting on, but procurement cannot see who is blocked on the goods.
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        prNumber: 'PR-202604-0001',
        status: 'DRAFT',
        priority: 'NORMAL',
        propertyId: mockPropertyId,
        requestedBy: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: [],
        supplierQuotes: [],
        materialRequisitions: [
          {
            id: 'mr-1',
            reqNumber: 'RCP-202604-0009',
            status: 'WAITING_STOCK',
            createdAt: new Date('2026-04-01'),
            _count: { items: 3 },
          },
        ],
      });

      const result = (await service.findOne(mockPRId, mockTenantId)) as any;

      expect(result.materialRequisitions).toEqual([
        expect.objectContaining({
          id: 'mr-1',
          reqNumber: 'RCP-202604-0009',
          status: 'WAITING_STOCK',
          lineCount: 3,
        }),
      ]);
    });

    // ---- ใบขอซื้อที่ปิดเพราะ "ไปซื้อเอง" ----
    // CLOSED เป็นคำเดียวกับใบที่ปิดทิ้ง คนอ่านจึงแยกไม่ออกว่าของมาถึงคลังหรือยัง
    // คำตอบต้องมาจากใบรับของจริง ไม่ใช่จากธงอีกตัวที่อาจขัดกันเองภายหลัง
    describe('ใบรับของที่ผูกกับใบขอซื้อ', () => {
      const closedByCashPurchase = (over: Record<string, unknown> = {}) => ({
        id: mockPRId,
        tenantId: mockTenantId,
        prNumber: 'PR-202608-0001',
        status: 'CLOSED',
        priority: 'NORMAL',
        propertyId: mockPropertyId,
        requestedBy: mockUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        supplierQuotes: [],
        items: [
          {
            id: 'row-1',
            itemId: 'inv-1',
            item: { name: 'เห็ดฟาง', sku: 'ING-AUTO-0008' },
            quantity: 1000,
            estimatedUnitPrice: null,
          },
        ],
        goodsReceives: [
          {
            id: 'gr-1',
            grNumber: 'GR-202608-0004',
            receiveDate: new Date('2026-08-10'),
            status: 'ACCEPTED',
            source: 'CASH_PURCHASE',
            vendorName: 'ตลาดสี่มุมเมือง',
            paymentMethod: 'OWN_MONEY',
            hasNoReceipt: false,
            invoiceNumber: 'MOCK-3557',
            totalAmount: 870,
            paidBy: 'user-payer',
            warehouse: { name: 'คลังครัวกลาง' },
            items: [
              { itemId: 'inv-1', receivedQty: 1000, unitCost: 0.87, totalCost: 870 },
            ],
          },
        ],
        ...over,
      });

      it('ส่งใบรับของที่ผูกไว้กลับไปด้วย พร้อมสรุปว่าได้ของครบหรือยัง', async () => {
        mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
          closedByCashPurchase(),
        );
        mockPrismaService.user.findMany.mockResolvedValue([
          { id: 'user-payer', firstName: 'สมชาย', lastName: 'ใจดี', email: 's@x.co' },
        ]);

        const result = (await service.findOne(mockPRId, mockTenantId)) as any;

        expect(result.goodsReceives).toEqual([
          expect.objectContaining({
            grNumber: 'GR-202608-0004',
            source: 'CASH_PURCHASE',
            vendorName: 'ตลาดสี่มุมเมือง',
            totalAmount: 870,
            paidByName: 'สมชาย ใจดี',
          }),
        ]);
        expect(result.fulfillment).toEqual(
          expect.objectContaining({ cashPurchaseCount: 1, fullyReceived: true, totalPaid: 870 }),
        );
      });

      it('บรรทัดที่ได้ของแล้ว ต้องพกราคาที่จ่ายจริงกลับไป ไม่ใช่แค่ประมาณการที่ว่างเปล่า', async () => {
        mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
          closedByCashPurchase(),
        );
        mockPrismaService.user.findMany.mockResolvedValue([]);

        const result = (await service.findOne(mockPRId, mockTenantId)) as any;

        expect(result.items[0]).toEqual(
          expect.objectContaining({
            receivedQty: 1000,
            actualUnitCost: 0.87,
            actualTotalCost: 870,
          }),
        );
      });

      it('ดึงเฉพาะใบรับของของ tenant นี้', async () => {
        mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
          closedByCashPurchase(),
        );
        mockPrismaService.user.findMany.mockResolvedValue([]);

        await service.findOne(mockPRId, mockTenantId);

        const include = mockPrismaService.purchaseRequisition.findFirst.mock.calls[0][0]
          .include as any;
        expect(include.goodsReceives.where).toEqual({ tenantId: mockTenantId });
      });

      it('หาชื่อคนออกเงินเฉพาะใน tenant นี้ — id มาจาก client ไม่มี foreign key คุม', async () => {
        mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
          closedByCashPurchase(),
        );
        mockPrismaService.user.findMany.mockResolvedValue([]);

        await service.findOne(mockPRId, mockTenantId);

        expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ tenantId: mockTenantId }),
          }),
        );
      });

      it('ใบที่ไม่มีใบรับของ ไม่ถูกอ้างว่าได้ของแล้ว', async () => {
        mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
          closedByCashPurchase({ goodsReceives: [] }),
        );
        mockPrismaService.user.findMany.mockResolvedValue([]);

        const result = (await service.findOne(mockPRId, mockTenantId)) as any;

        expect(result.goodsReceives).toEqual([]);
        expect(result.fulfillment.fullyReceived).toBe(false);
        expect(result.items[0].receivedQty).toBe(0);
        expect(result.items[0].actualUnitCost).toBeNull();
      });
    });

    it('should throw NotFoundException if PR not found', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id', mockTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if PR belongs to different tenant', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: 'other-tenant',
      });

      await expect(service.findOne(mockPRId, mockTenantId)).rejects.toThrow(NotFoundException);
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
      mockPrismaService.property.findFirst.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      mockPrismaService.supplier.findMany.mockResolvedValue([{ id: 'supplier-1' }]);

      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 1,
      });

      const createdPR = {
        id: 'new-pr-id',
        prNumber: 'PR-202604-0001',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(createdPR);
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      // Mock findOne for the return value
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
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
      mockPrismaService.property.findFirst.mockResolvedValue(null);

      await expect(service.create(createDto, mockUserId, mockTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if inventory items not found', async () => {
      mockPrismaService.property.findFirst.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      // Return only 1 item when 2 are expected
      mockPrismaService.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-item-1' }]);

      await expect(service.create(createDto, mockUserId, mockTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if preferred supplier not found', async () => {
      mockPrismaService.property.findFirst.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      // Return empty suppliers
      mockPrismaService.supplier.findMany.mockResolvedValue([]);

      await expect(service.create(createDto, mockUserId, mockTenantId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ===================== update =====================
  describe('update', () => {
    it('should update a DRAFT PR successfully', async () => {
      mockPrismaService.purchaseRequisition.findFirst
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
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'APPROVED',
      });

      await expect(
        service.update(mockPRId, { purpose: 'Should fail' }, mockTenantId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replace items when items array is provided', async () => {
      mockPrismaService.purchaseRequisition.findFirst
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

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-item-3' }]);
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

      expect(mockPrismaService.purchaseRequisitionItem.deleteMany).toHaveBeenCalledWith({
        where: { purchaseRequisitionId: mockPRId },
      });
      expect(mockPrismaService.purchaseRequisitionItem.createMany).toHaveBeenCalled();
    });
  });

  // ===================== submit =====================
  describe('submit', () => {
    it('should change DRAFT to PENDING_APPROVAL', async () => {
      mockPrismaService.purchaseRequisition.findFirst
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
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'APPROVED',
      });

      await expect(service.submit(mockPRId, mockTenantId)).rejects.toThrow(BadRequestException);
    });
  });

  // ===================== approve =====================
  describe('approve', () => {
    it('should change PENDING_APPROVAL to APPROVED', async () => {
      mockPrismaService.purchaseRequisition.findFirst
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

      const result = await service.approve(mockPRId, mockUserId, mockTenantId);
      expect((result as any).status).toBe('APPROVED');
      expect((result as any).approvedBy).toBe(mockUserId);
    });

    it('should reject approve if not in PENDING_APPROVAL status', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'DRAFT',
      });

      await expect(service.approve(mockPRId, mockUserId, mockTenantId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ===================== cancel =====================
  describe('cancel', () => {
    it('should cancel a PR with reason', async () => {
      mockPrismaService.purchaseRequisition.findFirst
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

      const result = await service.cancel(mockPRId, 'Budget cut', mockUserId, mockTenantId);
      expect((result as any).status).toBe('CANCELLED');
      expect((result as any).cancelReason).toBe('Budget cut');
    });

    it('should reject cancel if PO already created', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
        id: mockPRId,
        tenantId: mockTenantId,
        status: 'PO_CREATED',
      });

      await expect(service.cancel(mockPRId, 'Too late', mockUserId, mockTenantId)).rejects.toThrow(
        BadRequestException,
      );
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

      mockPrismaService.property.findFirst.mockResolvedValue({
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
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(createdPR);
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
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

      mockPrismaService.property.findFirst.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });

      mockPrismaService.inventoryItem.findMany.mockResolvedValue([
        { id: 'inv-item-1' },
        { id: 'inv-item-2' },
      ]);

      mockPrismaService.supplier.findMany.mockResolvedValue([{ id: 'supplier-1' }]);

      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 3,
      });

      const createdPR = {
        id: 'new-pr-dedup',
        prNumber: 'PR-202604-0003',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(createdPR);
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 2,
      });

      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
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

      mockPrismaService.property.findFirst.mockResolvedValue({
        id: mockPropertyId,
        tenantId: mockTenantId,
      });
      mockPrismaService.inventoryItem.findMany.mockResolvedValue([{ id: 'inv-item-1' }]);
      mockPrismaService.documentSequence.upsert.mockResolvedValue({
        lastNumber: 4,
      });

      const createdPR = {
        id: 'minimal-pr',
        prNumber: 'PR-202604-0004',
        tenantId: mockTenantId,
      };
      mockPrismaService.purchaseRequisition.create.mockResolvedValue(createdPR);
      mockPrismaService.purchaseRequisitionItem.createMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue({
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

      const result = await service.create(minimalDto as any, mockUserId, mockTenantId);
      expect(result).toHaveProperty('status', 'DRAFT');
    });
  });

  // ===================== Full Lifecycle =====================
  describe('full lifecycle: DRAFT → PENDING_APPROVAL → APPROVED → cancel', () => {
    it('should progress through status transitions correctly', async () => {
      // Step 1: Submit (DRAFT → PENDING_APPROVAL)
      mockPrismaService.purchaseRequisition.findFirst
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
      mockPrismaService.purchaseRequisition.findFirst
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

      const approved = await service.approve(mockPRId, mockUserId, mockTenantId);
      expect((approved as any).status).toBe('APPROVED');
      expect((approved as any).approvedBy).toBe(mockUserId);

      // Step 3: Cancel (APPROVED → CANCELLED)
      mockPrismaService.purchaseRequisition.findFirst
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
  describe('createPOFromPR', () => {
    /**
     * A purchase order is a commitment to pay. Anything the chosen supplier did
     * not put a price on has no agreed price at all — the old code fell through
     * to 0 and quietly ordered it for free.
     */
    const QUOTE_ID = 'quote-001';
    const WAREHOUSE_ID = 'wh-001';

    const buildPR = (items: any[], quoteItems: any[]) => ({
      id: mockPRId,
      tenantId: mockTenantId,
      propertyId: mockPropertyId,
      prNumber: 'PR-202608-0001',
      status: 'PENDING_QUOTES',
      notes: null,
      internalNotes: null,
      items,
      supplierQuotes: [{ id: QUOTE_ID, supplierId: 'sup-001', items: quoteItems }],
    });

    beforeEach(() => {
      mockPrismaService.warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_ID,
        tenantId: mockTenantId,
      });
      mockPrismaService.documentSequence.upsert.mockResolvedValue({ lastNumber: 1 });
      mockPrismaService.purchaseOrder.create.mockResolvedValue({ id: 'po-001', poNumber: 'PO-1' });
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-001' });
    });

    it('refuses to create a PO when the chosen quote skipped a requisition line', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
        buildPR(
          [
            { itemId: 'item-a', quantity: 10, notes: null, item: { name: 'ถั่วฝักยาว' } },
            { itemId: 'item-b', quantity: 5, notes: null, item: { name: 'น้ำมันพืช' } },
          ],
          [{ itemId: 'item-a', unitPrice: 20, totalPrice: 200 }],
        ),
      );

      await expect(
        service.createPOFromPR(mockPRId, QUOTE_ID, WAREHOUSE_ID, mockUserId, mockTenantId),
      ).rejects.toThrow(BadRequestException);

      // Names the item, so the buyer knows what to chase instead of a UUID.
      await expect(
        service.createPOFromPR(mockPRId, QUOTE_ID, WAREHOUSE_ID, mockUserId, mockTenantId),
      ).rejects.toThrow(/น้ำมันพืช/);

      expect(mockPrismaService.purchaseOrder.create).not.toHaveBeenCalled();
      expect(mockPrismaService.purchaseOrderItem.createMany).not.toHaveBeenCalled();
    });

    it('never writes a PO line at 0 baht just because an estimate was missing', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
        buildPR([{ itemId: 'item-a', quantity: 10, notes: null, item: { name: 'ถั่วฝักยาว' } }], []),
      );

      await expect(
        service.createPOFromPR(mockPRId, QUOTE_ID, WAREHOUSE_ID, mockUserId, mockTenantId),
      ).rejects.toThrow(BadRequestException);
    });

    it('prices every line from the quote and totals the header from those same lines', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
        buildPR(
          [
            { itemId: 'item-a', quantity: 10, notes: 'ด่วน', item: { name: 'ถั่วฝักยาว' } },
            { itemId: 'item-b', quantity: 5, notes: null, item: { name: 'น้ำมันพืช' } },
          ],
          [
            { itemId: 'item-a', unitPrice: 20, totalPrice: 200 },
            { itemId: 'item-b', unitPrice: 60, totalPrice: 300 },
            // An extra quote line the requisition never asked for must not be ordered.
            { itemId: 'item-ghost', unitPrice: 999, totalPrice: 9990 },
          ],
        ),
      );

      await service.createPOFromPR(mockPRId, QUOTE_ID, WAREHOUSE_ID, mockUserId, mockTenantId);

      const lines = mockPrismaService.purchaseOrderItem.createMany.mock.calls[0][0].data;
      expect(lines).toHaveLength(2);
      expect(lines.every((l: any) => l.unitPrice > 0 && l.totalPrice > 0)).toBe(true);

      // Header must equal the sum of what is actually printed underneath it —
      // 500, not the 10,490 the whole quote adds up to.
      const header = mockPrismaService.purchaseOrder.create.mock.calls[0][0].data;
      expect(header.subtotal).toBe(500);
      expect(header.totalAmount).toBe(500);
    });

    it('falls back to quantity x unit price when the quote line carries no total', async () => {
      mockPrismaService.purchaseRequisition.findFirst.mockResolvedValue(
        buildPR(
          [{ itemId: 'item-a', quantity: 4, notes: null, item: { name: 'ถั่วฝักยาว' } }],
          [{ itemId: 'item-a', unitPrice: 25, totalPrice: 0 }],
        ),
      );

      await service.createPOFromPR(mockPRId, QUOTE_ID, WAREHOUSE_ID, mockUserId, mockTenantId);

      const lines = mockPrismaService.purchaseOrderItem.createMany.mock.calls[0][0].data;
      expect(lines[0].totalPrice).toBe(100);
    });
  });
});
