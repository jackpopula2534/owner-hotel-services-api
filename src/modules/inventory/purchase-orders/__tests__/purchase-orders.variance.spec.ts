import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersService } from '../purchase-orders.service';
import { PrismaService } from '@/prisma/prisma.service';

/**
 * Sprint 4 — Variance + Force-Close behavior.
 */
describe('PurchaseOrdersService — Sprint 4 Variance + Force Close', () => {
  let service: PurchaseOrdersService;

  const tenantId = 'tenant-001';
  const userId = 'user-001';

  const mockPrisma = {
    purchaseOrder: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(PurchaseOrdersService);
  });

  describe('forceClose', () => {
    it('rejects when reason is missing or too short', async () => {
      await expect(service.forceClose('po-1', userId, '', tenantId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.forceClose('po-1', userId, 'abc', tenantId)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFoundException when PO does not exist', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
      await expect(
        service.forceClose('po-missing', userId, 'supplier bankrupt', tenantId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects from non-receiving statuses', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        tenantId,
        status: 'DRAFT',
        items: [],
      });
      await expect(
        service.forceClose('po-1', userId, 'reason that is long enough', tenantId),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates PO to CLOSED + records forceClosedAt/By/Reason from PARTIAL', async () => {
      mockPrisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          id: 'po-1',
          tenantId,
          status: 'PARTIALLY_RECEIVED',
          items: [],
        })
        // Second call comes from findOne() at the end of forceClose
        .mockResolvedValueOnce({
          id: 'po-1',
          tenantId,
          poNumber: 'PO-X',
          status: 'CLOSED',
          items: [],
          supplier: {
            name: 'X',
            id: 's',
            code: null,
            contactPerson: null,
            email: null,
            phone: null,
            address: null,
            taxId: null,
            paymentTerms: null,
          },
          goodsReceives: [],
          forceClosedAt: new Date(),
          forceClosedReason: 'supplier bankrupt — short by 200',
        });
      mockPrisma.purchaseOrder.update.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-X',
      });

      await service.forceClose('po-1', userId, 'supplier bankrupt — short by 200', tenantId);

      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1' },
          data: expect.objectContaining({
            status: 'CLOSED',
            forceClosedBy: userId,
            forceClosedReason: 'supplier bankrupt — short by 200',
          }),
        }),
      );
    });
  });

  describe('findVariance', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    it('classifies SHORT_DELIVERY when received < ordered without overdue', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-1',
          poNumber: 'PO-1',
          status: 'PARTIALLY_RECEIVED',
          totalAmount: 10_000,
          expectedDate: new Date('2099-01-01'), // future — not overdue
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 100, receivedQty: 60, totalPrice: 10_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].reason).toBe('SHORT_DELIVERY');
      expect(result.data[0].deltaQty).toBe(-40);
      // (10_000 / 100) * -40 = -4000
      expect(result.data[0].deltaAmount).toBeCloseTo(-4000, 1);
    });

    it('classifies OVERDUE when partial AND past expectedDate', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-2',
          poNumber: 'PO-2',
          status: 'PARTIALLY_RECEIVED',
          totalAmount: 5_000,
          expectedDate: yesterday,
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 100, receivedQty: 60, totalPrice: 5_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data[0].reason).toBe('OVERDUE');
    });

    it('classifies OVER_DELIVERY when received > ordered', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-3',
          poNumber: 'PO-3',
          status: 'FULLY_RECEIVED',
          totalAmount: 1_000,
          expectedDate: null,
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 100, receivedQty: 120, totalPrice: 1_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data[0].reason).toBe('OVER_DELIVERY');
      expect(result.data[0].deltaQty).toBe(20);
    });

    it('classifies INVOICE_MISMATCH when invoiced qty != received qty', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-4',
          poNumber: 'PO-4',
          status: 'FULLY_RECEIVED',
          totalAmount: 5_000,
          expectedDate: null,
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 50, receivedQty: 50, totalPrice: 5_000 }],
          goodsReceives: [
            {
              invoiceNumber: 'INV-1',
              items: [{ receivedQty: 52, totalCost: 5200 }], // invoice claims 52
            },
          ],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data[0].reason).toBe('INVOICE_MISMATCH');
      expect(result.data[0].invoicedQty).toBe(52);
      expect(result.data[0].invoicedAmount).toBe(5200);
    });

    it('classifies FORCE_CLOSED when forceClosedAt is set, regardless of qty', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-5',
          poNumber: 'PO-5',
          status: 'CLOSED',
          totalAmount: 5_000,
          expectedDate: yesterday,
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 100, receivedQty: 30, totalPrice: 5_000 }],
          goodsReceives: [],
          forceClosedAt: new Date(),
          forceClosedReason: 'supplier bankrupt',
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data[0].reason).toBe('FORCE_CLOSED');
      expect(result.data[0].forceClosedReason).toBe('supplier bankrupt');
    });

    it('excludes rows where qty matches and nothing is overdue or force-closed', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        {
          id: 'po-6',
          poNumber: 'PO-6',
          status: 'FULLY_RECEIVED',
          totalAmount: 1_000,
          expectedDate: null,
          supplierId: 's',
          supplier: { name: 'Acme' },
          items: [{ quantity: 50, receivedQty: 50, totalPrice: 1_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data).toHaveLength(0);
      expect(result.meta.netDeltaAmount).toBe(0);
    });

    it('aggregates netDeltaAmount across rows', async () => {
      mockPrisma.purchaseOrder.findMany.mockResolvedValue([
        // -4000
        {
          id: 'a',
          poNumber: 'A',
          status: 'PARTIALLY_RECEIVED',
          totalAmount: 10_000,
          expectedDate: new Date('2099-01-01'),
          supplierId: 's',
          supplier: { name: 'X' },
          items: [{ quantity: 100, receivedQty: 60, totalPrice: 10_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
        // +200
        {
          id: 'b',
          poNumber: 'B',
          status: 'FULLY_RECEIVED',
          totalAmount: 1_000,
          expectedDate: null,
          supplierId: 's',
          supplier: { name: 'X' },
          items: [{ quantity: 100, receivedQty: 120, totalPrice: 1_000 }],
          goodsReceives: [],
          forceClosedAt: null,
          forceClosedReason: null,
        },
      ]);

      const result = await service.findVariance(tenantId, {});
      expect(result.data).toHaveLength(2);
      expect(result.meta.netDeltaAmount).toBeCloseTo(-3800, 1); // -4000 + 200
    });
  });
});
