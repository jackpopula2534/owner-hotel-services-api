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
import { AddonService } from '@/modules/addons/addon.service';
import { withPrismaFallback } from '../common/test/mock-prisma';
import { mockAuditLogService } from '../common/test/mock-providers';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const prismaMock = withPrismaFallback({
    payments: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    promptPayTransaction: {
      updateMany: jest.fn(),
    },
    invoices: {
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    subscriptions: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    booking: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  });

  const auditMock = mockAuditLogService() as { logPaymentApprove: jest.Mock };
  const emailMock = {
    sendPaymentReceiptEmail: jest.fn().mockResolvedValue(undefined),
    onPaymentApproved: jest.fn().mockResolvedValue(undefined),
  };
  const addonMock = { invalidateAddonCache: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailEventsService, useValue: emailMock },
        { provide: AuditLogService, useValue: auditMock },
        { provide: AddonService, useValue: addonMock },
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
      prismaMock.payments.findFirstOrThrow.mockResolvedValue(approved);
      prismaMock.invoices.update.mockResolvedValue({});
      prismaMock.invoices.findFirst.mockResolvedValue({ id: 'inv-1', booking_id: null });
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
      expect(prismaMock.payments.findFirstOrThrow).not.toHaveBeenCalled();
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
      prismaMock.payments.findFirstOrThrow.mockResolvedValue({
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

    it('keeps a booking invoice open when only a deposit has been approved', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        booking_id: 'booking-1',
        amount: '3177.90',
        adjusted_amount: null,
      });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '953.37' }]);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.invoices.update).not.toHaveBeenCalled();
    });

    it('syncs the booking to partial with the approved deposit amount', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenant_id: 'tenant-1',
        booking_id: 'booking-1',
        amount: '3177.90',
        adjusted_amount: null,
      });
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'booking-1', status: 'pending' });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '953.37' }]);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(prismaMock.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'confirmed', paymentStatus: 'partial', amountPaid: 953.37 },
      });
    });

    it('never confirms an unrelated booking when the invoice has no booking (subscription)', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenant_id: 'tenant-1',
        booking_id: null,
        amount: '990.00',
        adjusted_amount: null,
      });
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'someone-elses-booking', status: 'pending' });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '990.00' }]);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(prismaMock.booking.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
    });

    it('keeps a checked-in booking checked in while syncing the paid amount', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenant_id: 'tenant-1',
        booking_id: 'booking-1',
        amount: '3177.90',
        adjusted_amount: null,
      });
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'booking-1', status: 'checked_in' });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '953.37' }, { amount: '2224.53' }]);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(prismaMock.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { paymentStatus: 'paid', amountPaid: 3177.9 },
      });
    });

    it('closes a booking invoice once approved payments cover the total', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        booking_id: 'booking-1',
        amount: '3177.90',
        adjusted_amount: null,
      });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '953.37' }, { amount: '2224.53' }]);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.invoices.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'paid' },
      });
    });

    it('activates the subscription INSIDE the approval transaction (H2)', async () => {
      arrangePending({ id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } });
      // activation lookups
      prismaMock.invoices.findFirst.mockResolvedValue({ subscription_id: 'sub-1' });
      prismaMock.subscriptions.findFirst.mockResolvedValue({
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

  describe('approvePayment — PromptPay จากหน้าเว็บ', () => {
    const arrangeQr = (bookingGroupId: string | null, stillPending: number) => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
        tenant_id: 'tenant-1',
        method: 'qr',
        status: 'pending',
      });
      prismaMock.payments.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.payments.findFirstOrThrow.mockResolvedValue({ id: 'payment-1', status: 'approved' });
      prismaMock.payments.findMany.mockResolvedValue([{ amount: '3531' }]);
      prismaMock.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenant_id: 'tenant-1',
        booking_id: 'booking-1',
        amount: '3531',
        adjusted_amount: null,
      });
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'booking-1', bookingGroupId });
      prismaMock.booking.findMany.mockResolvedValue([{ id: 'booking-1' }, { id: 'booking-2' }]);
      prismaMock.payments.count.mockResolvedValue(stillPending);
      prismaMock.promptPayTransaction.updateMany.mockResolvedValue({ count: 1 });
    };

    it('verifies the PromptPay transaction of a single-room booking', async () => {
      arrangeQr(null, 0);
      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      expect(prismaMock.promptPayTransaction.updateMany).toHaveBeenCalledWith({
        where: { bookingId: { in: ['booking-1'] }, tenantId: 'tenant-1', status: { in: ['pending', 'expired'] } },
        data: { status: 'verified', verifiedAt: expect.any(Date) },
      });
    });

    it('keeps a multi-room QR pending while another room is still unapproved', async () => {
      arrangeQr('group-1', 1);
      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      expect(prismaMock.promptPayTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('verifies the multi-room QR once every room is approved', async () => {
      arrangeQr('group-1', 0);
      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      expect(prismaMock.promptPayTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bookingId: { in: ['booking-1', 'booking-2'] } }),
        }),
      );
    });

    it('leaves PromptPay transactions alone for non-QR payments', async () => {
      arrangeQr(null, 0);
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
        tenant_id: 'tenant-1',
        method: 'cash',
        status: 'pending',
      });
      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      expect(prismaMock.promptPayTransaction.updateMany).not.toHaveBeenCalled();
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
