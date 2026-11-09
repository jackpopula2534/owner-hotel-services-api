/**
 * Coverage for BookingsService.requestEarlyCheckIn — kept separate so the
 * already-large bookings.service.spec.ts doesn't grow further.
 *
 * Branches covered:
 *   - missing tenantId → BadRequestException
 *   - cancelled / checked_out booking → BadRequestException
 *   - already-requested → BadRequestException
 *   - property not found → BadRequestException
 *   - earlyCheckInEnabled=false → BadRequestException
 *   - happy path: request only (no fee write)
 *   - happy path: request + auto-approve (writes fee, calls auditLog)
 */
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { EmailEventsService } from '../../email/email-events.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { mockAuditLogService, mockEventEmitter } from '../../common/test/mock-providers';
import { withPrismaFallback } from '../../common/test/mock-prisma';
import { RevenuePostingService } from '../revenue/revenue-posting.service';
import { buildRevenuePostingStub } from '../revenue/__tests__/revenue-posting.stub';
import { BookingsService } from './bookings.service';

describe('BookingsService — requestEarlyCheckIn', () => {
  let service: BookingsService;

  const baseBooking = {
    id: 'booking-1',
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    guestFirstName: 'Alice',
    guestLastName: 'Wong',
    status: 'confirmed',
    requestedEarlyCheckIn: false,
    approvedEarlyCheckIn: false,
    earlyCheckInFee: 0,
  };

  const prismaMock = withPrismaFallback({
    booking: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    property: {
      findFirst: jest.fn(),
    },
  });
  const auditLogMock = mockAuditLogService();

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: mockEventEmitter() },
        { provide: AuditLogService, useValue: auditLogMock },
        {
          provide: EmailEventsService,
          useValue: {
            onBookingCreated: jest.fn(),
            onBookingCheckout: jest.fn(),
            sendReviewRequest: jest.fn(),
          },
        },
        { provide: HousekeepingService, useValue: { createTask: jest.fn() } },
        { provide: InvoicesService, useValue: {} },
        { provide: LoyaltyService, useValue: { addPointsForStay: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PaymentsService, useValue: {} },
        { provide: RevenuePostingService, useValue: buildRevenuePostingStub() },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
    jest.clearAllMocks();
    // Bypass mapBookingResponse formatting — we only assert side effects + DB writes.
    jest.spyOn(service as any, 'mapBookingResponse').mockImplementation((b) => b);
  });

  it('rejects when tenantId is missing', async () => {
    await expect(service.requestEarlyCheckIn('booking-1', undefined)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['cancelled', 'checked_out'])('rejects when booking is in status=%s', async (status) => {
    prismaMock.booking.findFirst.mockResolvedValue({ ...baseBooking, status });
    await expect(service.requestEarlyCheckIn('booking-1', 'tenant-1')).rejects.toThrow(
      /Cannot request early check-in/,
    );
  });

  it('rejects when early check-in was already requested', async () => {
    prismaMock.booking.findFirst.mockResolvedValue({
      ...baseBooking,
      requestedEarlyCheckIn: true,
    });
    await expect(service.requestEarlyCheckIn('booking-1', 'tenant-1')).rejects.toThrow(
      /already been requested/,
    );
  });

  it('rejects when property is not found', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue(null);
    await expect(service.requestEarlyCheckIn('booking-1', 'tenant-1')).rejects.toThrow(
      /Property not found/,
    );
  });

  it('rejects when earlyCheckInEnabled is false', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: false,
      earlyCheckInFeeType: 'flat',
      earlyCheckInFeeAmount: 500,
    });
    await expect(service.requestEarlyCheckIn('booking-1', 'tenant-1')).rejects.toThrow(
      /not enabled/,
    );
  });

  it('writes requestedEarlyCheckIn=true (no fee write) when approve=false', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: true,
      earlyCheckInFeeType: 'flat',
      earlyCheckInFeeAmount: 500,
    });
    prismaMock.booking.update.mockResolvedValue({ ...baseBooking, requestedEarlyCheckIn: true });

    await service.requestEarlyCheckIn('booking-1', 'tenant-1', false);

    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'booking-1' },
        data: { requestedEarlyCheckIn: true },
      }),
    );
  });

  it('approve=true charges the fee into the booking totals and the unpaid invoice', async () => {
    const priced = {
      ...baseBooking,
      roomSubtotal: 3000,
      totalPrice: 3000,
      serviceChargeAmount: 300,
      vatAmount: 231,
      grandTotal: 3531,
      pricingBreakdown: {
        nightlyRates: [{ appliedRate: 1500 }, { appliedRate: 1500 }],
        serviceChargePercent: 10,
        vatPercent: 7,
      },
    };
    prismaMock.booking.findFirst.mockResolvedValue(priced);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: true,
      earlyCheckInFeeType: 'fixed',
      earlyCheckInFeeAmount: 500,
    });
    prismaMock.booking.update.mockResolvedValue({ ...priced, approvedEarlyCheckIn: true });
    const invoicesUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prismaMock as any).invoices = { updateMany: invoicesUpdateMany };
    (prismaMock as any).$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMock));

    await service.requestEarlyCheckIn('booking-1', 'tenant-1', true);

    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedEarlyCheckIn: true,
          approvedEarlyCheckIn: true,
          earlyCheckInFee: 500,
          roomSubtotal: 3500,
          serviceChargeAmount: 350,
          vatAmount: 269.5,
          grandTotal: 4119.5,
        }),
      }),
    );
    expect(invoicesUpdateMany).toHaveBeenCalledWith({
      where: { booking_id: 'booking-1', tenant_id: 'tenant-1', status: { in: ['pending', 'draft'] } },
      data: { amount: 4119.5 },
    });
    // Audit log fired (fire-and-forget, but jest.fn will still record the call).
    expect((auditLogMock as { log: jest.Mock }).log).toHaveBeenCalled();
  });

  it('percentage fee is a share of the first night', async () => {
    prismaMock.booking.findFirst.mockResolvedValue({
      ...baseBooking,
      roomSubtotal: 3000,
      pricingBreakdown: { nightlyRates: [{ appliedRate: 1200 }, { appliedRate: 1800 }] },
    });
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: true,
      earlyCheckInFeeType: 'percentage',
      earlyCheckInFeeAmount: 50,
    });
    prismaMock.booking.update.mockResolvedValue(baseBooking);
    (prismaMock as any).invoices = { updateMany: jest.fn() };
    (prismaMock as any).$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prismaMock));

    await service.requestEarlyCheckIn('booking-1', 'tenant-1', true);

    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ earlyCheckInFee: 600, roomSubtotal: 3600 }) }),
    );
  });

  it('coerces null earlyCheckInFeeAmount to 0', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: true,
      earlyCheckInFeeType: 'flat',
      earlyCheckInFeeAmount: null,
    });
    prismaMock.booking.update.mockResolvedValue(baseBooking);
    await service.requestEarlyCheckIn('booking-1', 'tenant-1', true);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ earlyCheckInFee: 0 }),
      }),
    );
  });
});
