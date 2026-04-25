import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PriceComparisonsService } from '../price-comparisons.service';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService } from '@/audit-log/audit-log.service';
import { NotificationsService } from '@/notifications/notifications.service';

type ComparisonRow = {
  id: string;
  tenantId: string;
  comparisonNumber: string;
  purchaseRequisitionId: string;
  selectedQuoteId: string | null;
  comparedBy: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  rejectedBy?: string | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
};

describe('PriceComparisonsService — supervisor approval workflow', () => {
  let service: PriceComparisonsService;

  const tenantId = 'tenant-1';
  const buyerId = 'user-buyer';
  const managerId = 'user-manager';
  const comparisonId = 'pc-1';
  const prId = 'pr-1';
  const quoteId = 'quote-1';

  const baseComparison: ComparisonRow = {
    id: comparisonId,
    tenantId,
    comparisonNumber: 'PC-202604-0001',
    purchaseRequisitionId: prId,
    selectedQuoteId: null,
    comparedBy: buyerId,
    status: 'DRAFT',
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  };

  let comparisonState: ComparisonRow;

  const mockPrisma = {
    priceComparison: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    supplierQuote: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseRequisition: {
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(mockPrisma)),
  };

  const mockAuditLog = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  const mockNotifications = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceComparisonsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PriceComparisonsService>(PriceComparisonsService);

    jest.clearAllMocks();
    comparisonState = { ...baseComparison };

    mockPrisma.priceComparison.findUnique.mockImplementation(async () => ({
      ...comparisonState,
    }));
    mockPrisma.priceComparison.update.mockImplementation(
      async (args: { data: Partial<ComparisonRow> }) => {
        comparisonState = { ...comparisonState, ...args.data };
        return { ...comparisonState };
      },
    );
    mockPrisma.supplierQuote.findUnique.mockResolvedValue({
      id: quoteId,
      purchaseRequisitionId: prId,
    });
    mockPrisma.supplierQuote.update.mockResolvedValue({});
    mockPrisma.supplierQuote.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.purchaseRequisition.update.mockResolvedValue({});
    mockPrisma.user.findMany.mockResolvedValue([{ id: managerId }]);
  });

  describe('selectQuote', () => {
    it('moves comparison into PENDING_APPROVAL with submittedAt set', async () => {
      await service.selectQuote(
        comparisonId,
        { selectedQuoteId: quoteId, selectionReason: 'lowest price' },
        buyerId,
        tenantId,
      );

      const updateArgs = mockPrisma.priceComparison.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('PENDING_APPROVAL');
      expect(updateArgs.data.submittedAt).toBeInstanceOf(Date);
      expect(updateArgs.data.selectedQuoteId).toBe(quoteId);
      // rejection metadata is cleared
      expect(updateArgs.data.rejectedBy).toBeNull();
      expect(updateArgs.data.rejectedAt).toBeNull();
      expect(updateArgs.data.rejectionReason).toBeNull();
    });

    it('notifies procurement managers and writes audit log', async () => {
      await service.selectQuote(comparisonId, { selectedQuoteId: quoteId }, buyerId, tenantId);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId, role: 'procurement_manager' },
        select: { id: true },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: managerId,
          tenantId,
          message: expect.stringContaining('PC-202604-0001'),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'price_comparison_submitted',
          resourceId: comparisonId,
          tenantId,
          userId: buyerId,
        }),
      );
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      comparisonState = {
        ...baseComparison,
        status: 'PENDING_APPROVAL',
        selectedQuoteId: quoteId,
      };
    });

    it('marks comparison APPROVED and notifies buyer', async () => {
      await service.approve(comparisonId, managerId, tenantId);

      const updateArgs = mockPrisma.priceComparison.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('APPROVED');
      expect(updateArgs.data.approvedBy).toBe(managerId);
      expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: buyerId,
          tenantId,
          message: expect.stringContaining('สร้าง PO ได้'),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'price_comparison_approved',
          resourceId: comparisonId,
        }),
      );
    });

    it('throws BadRequestException when comparison already APPROVED', async () => {
      comparisonState = {
        ...baseComparison,
        status: 'APPROVED',
        selectedQuoteId: quoteId,
      };

      await expect(service.approve(comparisonId, managerId, tenantId)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.priceComparison.update).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      comparisonState = {
        ...baseComparison,
        status: 'PENDING_APPROVAL',
        selectedQuoteId: quoteId,
      };
    });

    it('persists rejection reason and notifies buyer', async () => {
      const reason = 'ราคาสูงกว่าที่ตั้งงบไว้';
      await service.reject(comparisonId, { rejectionReason: reason }, managerId, tenantId);

      const updateArgs = mockPrisma.priceComparison.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('REJECTED');
      expect(updateArgs.data.rejectedBy).toBe(managerId);
      expect(updateArgs.data.rejectionReason).toBe(reason);

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: buyerId,
          tenantId,
          message: expect.stringContaining(reason),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'price_comparison_rejected',
          newValues: { rejectionReason: reason },
        }),
      );
    });

    it('throws BadRequestException when comparison not in PENDING_APPROVAL', async () => {
      comparisonState = {
        ...baseComparison,
        status: 'DRAFT',
      };

      await expect(
        service.reject(comparisonId, { rejectionReason: 'no good' }, managerId, tenantId),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reselect after reject', () => {
    it('clears rejection metadata and resubmits to PENDING_APPROVAL', async () => {
      // Start state: previously rejected
      comparisonState = {
        ...baseComparison,
        status: 'REJECTED',
        selectedQuoteId: quoteId,
        rejectedBy: managerId,
        rejectedAt: new Date(),
        rejectionReason: 'ราคาสูง',
      };

      await service.selectQuote(
        comparisonId,
        { selectedQuoteId: quoteId, selectionReason: 'try again' },
        buyerId,
        tenantId,
      );

      const updateArgs = mockPrisma.priceComparison.update.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('PENDING_APPROVAL');
      expect(updateArgs.data.rejectedBy).toBeNull();
      expect(updateArgs.data.rejectedAt).toBeNull();
      expect(updateArgs.data.rejectionReason).toBeNull();
      expect(updateArgs.data.submittedAt).toBeInstanceOf(Date);
    });
  });
});
