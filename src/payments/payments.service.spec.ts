/**
 * Coverage for PaymentsService — focused on the security/financial-critical
 * paths that were untested:
 *   - approvePayment: missing payment → NotFoundException; happy path writes
 *     status=APPROVED, calls audit log, triggers email, and cascades invoice +
 *     booking status updates
 *   - rejectPayment: missing payment → throws; happy path writes status=REJECTED
 *
 * Does NOT cover the full create()/update() CRUD — those just shovel data into
 * Prisma and class-validator already protects the DTO shape.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailEventsService } from '../email/email-events.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { withPrismaFallback } from '../common/test/mock-prisma';
import { mockAuditLogService } from '../common/test/mock-providers';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const prismaMock = withPrismaFallback({
    payments: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    invoices: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    subscriptions: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    booking: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
  });

  const auditMock = mockAuditLogService() as { logPaymentApprove: jest.Mock };
  const emailMock = {
    sendPaymentReceiptEmail: jest.fn().mockResolvedValue(undefined),
    onPaymentApproved: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailEventsService, useValue: emailMock },
        { provide: AuditLogService, useValue: auditMock },
      ],
    }).compile();
    service = moduleRef.get(PaymentsService);
    jest.clearAllMocks();
    // Stub the private email helper so tests don't need full template wiring.
    jest
      .spyOn(
        service as unknown as { sendPaymentReceiptEmail: jest.Mock },
        'sendPaymentReceiptEmail',
      )
      .mockResolvedValue(undefined as never);
  });

  describe('approvePayment', () => {
    // After SALES-04 the approve flow claims the payment atomically via
    // updateMany (status guard) + invoice update inside a $transaction, then
    // reads the fresh row with findUniqueOrThrow. The mock-prisma $transaction
    // runs fn(prisma) so the same model mocks apply inside the callback.
    const arrangePending = (approved: Record<string, unknown>) => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
        status: 'pending',
      });
      prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.payments.findUniqueOrThrow.mockResolvedValue(approved);
      prismaMock.invoices.update.mockResolvedValue({});
      prismaMock.invoices.findUnique.mockResolvedValue({ id: 'inv-1', booking_id: null });
    };

    it('throws NotFoundException when payment is not found', async () => {
      prismaMock.payments.findFirst.mockResolvedValue(null);
      await expect(
        service.approvePayment('payment-1', 'admin-1', 'tenant-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
    });

    it('atomically claims the payment APPROVED with a status guard', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.payments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1', status: { not: 'approved' } },
          data: expect.objectContaining({
            status: 'approved',
            approved_by: 'admin-1',
            approved_at: expect.any(Date),
          }),
        }),
      );
    });

    it('is an idempotent no-op when the payment is already approved', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
        status: 'approved',
      });

      const result = await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(result).toEqual(expect.objectContaining({ id: 'payment-1', status: 'approved' }));
      // must NOT re-approve / re-extend / re-audit
      expect(prismaMock.payments.updateMany).not.toHaveBeenCalled();
      expect(auditMock.logPaymentApprove).not.toHaveBeenCalled();
    });

    it('is a no-op when the atomic claim loses the race (count=0)', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
        status: 'pending',
      });
      prismaMock.payments.updateMany.mockResolvedValue({ count: 0 });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      // never reads back / cascades after losing the claim
      expect(prismaMock.payments.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prismaMock.invoices.update).not.toHaveBeenCalled();
    });

    it('writes audit log and triggers receipt email on approval', async () => {
      const approved = { id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } };
      arrangePending(approved);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(auditMock.logPaymentApprove).toHaveBeenCalledWith(approved, 'admin-1');
    });

    it('skips invoice/booking cascade when payment has no invoice_id', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: null,
        status: 'pending',
      });
      prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.payments.findUniqueOrThrow.mockResolvedValue({
        id: 'payment-1',
        status: 'approved',
        invoices: null,
      });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.invoices.update).not.toHaveBeenCalled();
    });

    it('cascades invoice → "paid" inside the transaction when invoice_id is present', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(prismaMock.invoices.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'paid' },
      });
    });

    it('activates the subscription INSIDE the approval transaction (H2)', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      // activation lookups
      prismaMock.invoices.findUnique.mockResolvedValue({ subscription_id: 'sub-1' });
      prismaMock.subscriptions.findUnique.mockResolvedValue({
        id: 'sub-1',
        billing_cycle: 'monthly',
        end_date: null,
        status: 'trial',
      });
      prismaMock.subscriptions.update.mockResolvedValue({});

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.subscriptions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({ status: 'active' }),
        }),
      );
    });
  });

  describe('rejectPayment', () => {
    it('throws when payment is not found', async () => {
      prismaMock.payments.findFirst.mockResolvedValue(null);
      await expect(service.rejectPayment('payment-1', 'admin-1', 'tenant-1')).rejects.toThrow(
        'Payment not found',
      );
    });

    it('writes status=REJECTED with adminId + timestamp', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
      });
      prismaMock.payments.update.mockResolvedValue({ id: 'payment-1', status: 'REJECTED' });

      await service.rejectPayment('payment-1', 'admin-2', 'tenant-1');

      expect(prismaMock.payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: expect.objectContaining({
            status: 'rejected',
            approved_by: 'admin-2',
            approved_at: expect.any(Date),
          }),
        }),
      );
    });
  });
});
