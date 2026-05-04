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
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { EmailEventsService } from '../../email/email-events.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { mockAuditLogService } from '../../common/test/mock-providers';
import { withPrismaFallback } from '../../common/test/mock-prisma';
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
        { provide: AuditLogService, useValue: auditLogMock },
        { provide: EmailEventsService, useValue: { onBookingCreated: jest.fn(), onBookingCheckout: jest.fn(), sendReviewRequest: jest.fn() } },
        { provide: HousekeepingService, useValue: { createTask: jest.fn() } },
        { provide: InvoicesService, useValue: {} },
        { provide: LoyaltyService, useValue: { addPointsForStay: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: PaymentsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
    jest.clearAllMocks();
    // Bypass mapBookingResponse formatting — we only assert side effects + DB writes.
    jest.spyOn(service as any, 'mapBookingResponse').mockImplementation((b) => b);
  });

  it('rejects when tenantId is missing', async () => {
    await expect(
      service.requestEarlyCheckIn('booking-1', undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['cancelled', 'checked_out'])(
    'rejects when booking is in status=%s',
    async (status) => {
      prismaMock.booking.findFirst.mockResolvedValue({ ...baseBooking, status });
      await expect(
        service.requestEarlyCheckIn('booking-1', 'tenant-1'),
      ).rejects.toThrow(/Cannot request early check-in/);
    },
  );

  it('rejects when early check-in was already requested', async () => {
    prismaMock.booking.findFirst.mockResolvedValue({
      ...baseBooking,
      requestedEarlyCheckIn: true,
    });
    await expect(
      service.requestEarlyCheckIn('booking-1', 'tenant-1'),
    ).rejects.toThrow(/already been requested/);
  });

  it('rejects when property is not found', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue(null);
    await expect(
      service.requestEarlyCheckIn('booking-1', 'tenant-1'),
    ).rejects.toThrow(/Property not found/);
  });

  it('rejects when earlyCheckInEnabled is false', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: false,
      earlyCheckInFeeType: 'flat',
      earlyCheckInFeeAmount: 500,
    });
    await expect(
      service.requestEarlyCheckIn('booking-1', 'tenant-1'),
    ).rejects.toThrow(/not enabled/);
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

  it('writes both requestedEarlyCheckIn and approvedEarlyCheckIn + earlyCheckInFee when approve=true', async () => {
    prismaMock.booking.findFirst.mockResolvedValue(baseBooking);
    prismaMock.property.findFirst.mockResolvedValue({
      earlyCheckInEnabled: true,
      earlyCheckInFeeType: 'flat',
      earlyCheckInFeeAmount: 500,
    });
    prismaMock.booking.update.mockResolvedValue({
      ...baseBooking,
      requestedEarlyCheckIn: true,
      approvedEarlyCheckIn: true,
      earlyCheckInFee: 500,
    });

    await service.requestEarlyCheckIn('booking-1', 'tenant-1', true);

    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          requestedEarlyCheckIn: true,
          approvedEarlyCheckIn: true,
          earlyCheckInFee: 500,
        },
      }),
    );
    // Audit log fired (fire-and-forget, but jest.fn will still record the call).
    expect((auditLogMock as { log: jest.Mock }).log).toHaveBeenCalled();
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
