/**
 * Coverage for InvoicesService — focused on the new double-billing guard and
 * the self-service void flow:
 *   - create(): blocks a new SUBSCRIPTION invoice when an outstanding one
 *     exists (409 ConflictException); allows it when none outstanding; never
 *     blocks booking invoices; honours skipOutstandingCheck.
 *   - assertNoOutstandingSubscriptionInvoices(): throws / passes correctly.
 *   - voidInvoice(): not-found, already-paid, already-voided, happy path.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { withPrismaFallback } from '../common/test/mock-prisma';
import { InvoiceStatus } from './entities/invoice.entity';

describe('InvoicesService — double-billing guard & void', () => {
  let service: InvoicesService;

  const prismaMock = withPrismaFallback({
    invoices: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [InvoicesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(InvoicesService);
  });

  const baseDto = {
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    invoiceNo: 'INV-NEW',
    amount: 1380,
    status: InvoiceStatus.PENDING,
    dueDate: new Date().toISOString(),
  };

  describe('assertNoOutstandingSubscriptionInvoices', () => {
    it('passes when there are no outstanding invoices', async () => {
      prismaMock.invoices.findMany.mockResolvedValueOnce([]);
      await expect(
        service.assertNoOutstandingSubscriptionInvoices('tenant-1'),
      ).resolves.toBeUndefined();
    });

    it('throws ConflictException with details when outstanding invoices exist', async () => {
      prismaMock.invoices.findMany.mockResolvedValueOnce([
        { id: 'i1', invoice_no: 'INV-1', amount: 1380, status: 'pending', due_date: new Date() },
        { id: 'i2', invoice_no: 'INV-2', amount: 1380, status: 'finalized', due_date: new Date() },
      ]);
      await expect(
        service.assertNoOutstandingSubscriptionInvoices('tenant-1'),
      ).rejects.toMatchObject({
        response: {
          error: {
            code: 'OUTSTANDING_INVOICE_EXISTS',
            outstandingCount: 2,
            outstandingTotal: 2760,
          },
        },
      });
    });

    it('only queries pending/finalized subscription invoices (no booking)', async () => {
      prismaMock.invoices.findMany.mockResolvedValueOnce([]);
      await service.assertNoOutstandingSubscriptionInvoices('tenant-1');
      expect(prismaMock.invoices.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-1',
            booking_id: null,
            subscription_id: { not: null },
            status: { in: ['pending', 'finalized'] },
          }),
        }),
      );
    });
  });

  describe('create() guard', () => {
    it('blocks a new subscription invoice when one is outstanding', async () => {
      prismaMock.invoices.findMany.mockResolvedValueOnce([
        { id: 'i1', invoice_no: 'INV-1', amount: 1380, status: 'pending', due_date: new Date() },
      ]);
      await expect(service.create(baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(prismaMock.invoices.create).not.toHaveBeenCalled();
    });

    it('creates the invoice when nothing is outstanding', async () => {
      prismaMock.invoices.findMany.mockResolvedValueOnce([]);
      prismaMock.invoices.create.mockResolvedValueOnce({ id: 'new', invoice_no: 'INV-NEW' });
      const result = await service.create(baseDto);
      expect(result).toMatchObject({ invoice_no: 'INV-NEW' });
      expect(prismaMock.invoices.create).toHaveBeenCalledTimes(1);
    });

    it('skips the guard for booking invoices (no subscriptionId)', async () => {
      prismaMock.invoices.create.mockResolvedValueOnce({ id: 'b1' });
      await service.create({
        tenantId: 'tenant-1',
        bookingId: 'booking-1',
        invoiceNo: 'INV-BOOK',
        amount: 500,
        status: InvoiceStatus.PENDING,
        dueDate: new Date().toISOString(),
      });
      expect(prismaMock.invoices.findMany).not.toHaveBeenCalled();
      expect(prismaMock.invoices.create).toHaveBeenCalledTimes(1);
    });

    it('skips the guard when skipOutstandingCheck is set (seeder path)', async () => {
      prismaMock.invoices.create.mockResolvedValueOnce({ id: 'seed' });
      await service.create(baseDto, { skipOutstandingCheck: true });
      expect(prismaMock.invoices.findMany).not.toHaveBeenCalled();
      expect(prismaMock.invoices.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('voidInvoice()', () => {
    it('throws NotFoundException when invoice is missing', async () => {
      prismaMock.invoices.findFirst.mockResolvedValueOnce(null);
      await expect(service.voidInvoice('missing', undefined, 'tenant-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to void a paid invoice', async () => {
      prismaMock.invoices.findFirst.mockResolvedValueOnce({ id: 'i1', status: 'paid' });
      await expect(service.voidInvoice('i1', undefined, 'tenant-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.invoices.update).not.toHaveBeenCalled();
    });

    it('is a no-op error when already voided', async () => {
      prismaMock.invoices.findFirst.mockResolvedValueOnce({ id: 'i1', status: 'voided' });
      await expect(service.voidInvoice('i1', undefined, 'tenant-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('voids a pending invoice and records reason + timestamp', async () => {
      prismaMock.invoices.findFirst.mockResolvedValueOnce({
        id: 'i1',
        invoice_no: 'INV-1',
        tenant_id: 'tenant-1',
        status: 'pending',
      });
      prismaMock.invoices.update.mockResolvedValueOnce({
        id: 'i1',
        invoice_no: 'INV-1',
        tenant_id: 'tenant-1',
        status: 'voided',
      });
      const result = await service.voidInvoice('i1', 'ออกผิด', 'tenant-1');
      expect(result.status).toBe('voided');
      expect(prismaMock.invoices.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'i1' },
          data: expect.objectContaining({
            status: 'voided',
            voided_reason: 'ออกผิด',
            voided_at: expect.any(Date),
          }),
        }),
      );
    });
  });
});
