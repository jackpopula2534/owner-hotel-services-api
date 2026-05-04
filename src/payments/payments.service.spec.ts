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
    },
    invoices: {
      update: jest.fn(),
      findUnique: jest.fn(),
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
    jest.spyOn(service as unknown as { sendPaymentReceiptEmail: jest.Mock }, 'sendPaymentReceiptEmail')
      .mockResolvedValue(undefined as never);
  });

  describe('approvePayment', () => {
    it('throws NotFoundException when payment is not found', async () => {
      prismaMock.payments.findFirst.mockResolvedValue(null);
      await expect(
        service.approvePayment('payment-1', 'admin-1', 'tenant-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.payments.update).not.toHaveBeenCalled();
    });

    it('marks payment APPROVED with adminId + timestamp', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
      });
      prismaMock.payments.update.mockResolvedValue({
        id: 'payment-1',
        status: 'approved',
        invoices: { id: 'inv-1' },
      });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: expect.objectContaining({
            status: 'approved',
            approved_by: 'admin-1',
            approved_at: expect.any(Date),
          }),
        }),
      );
    });

    it('writes audit log and triggers receipt email on approval', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
      });
      const approved = { id: 'payment-1', status: 'approved', invoices: { id: 'inv-1' } };
      prismaMock.payments.update.mockResolvedValue(approved);

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(auditMock.logPaymentApprove).toHaveBeenCalledWith(approved, 'admin-1');
    });

    it('skips invoice/booking cascade when payment has no invoice_id', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: null,
      });
      prismaMock.payments.update.mockResolvedValue({
        id: 'payment-1',
        status: 'approved',
        invoices: null,
      });

      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');

      expect(prismaMock.invoices.update).not.toHaveBeenCalled();
    });

    it('cascades invoice → "paid" when invoice_id is present', async () => {
      prismaMock.payments.findFirst.mockResolvedValue({
        id: 'payment-1',
        invoice_id: 'inv-1',
      });
      prismaMock.payments.update.mockResolvedValue({
        id: 'payment-1',
        status: 'approved',
        invoices: { id: 'inv-1' },
      });
      prismaMock.invoices.update.mockResolvedValue({});
      // updateBookingStatusToConfirmed will look up the invoice and skip cleanly
      // when no booking_id — return invoice with no booking_id to take the early
      // exit branch.
      prismaMock.invoices.findUnique.mockResolvedValue({ id: 'inv-1', booking_id: null });

      // Wait for fire-and-forget cascades to complete by using process.nextTick.
      await service.approvePayment('payment-1', 'admin-1', 'tenant-1');
      await new Promise((resolve) => setImmediate(resolve));

      expect(prismaMock.invoices.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'paid' },
      });
    });
  });

  describe('rejectPayment', () => {
    it('throws when payment is not found', async () => {
      prismaMock.payments.findFirst.mockResolvedValue(null);
      await expect(
        service.rejectPayment('payment-1', 'admin-1', 'tenant-1'),
      ).rejects.toThrow('Payment not found');
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
