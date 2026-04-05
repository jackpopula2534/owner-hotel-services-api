import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailEventsService } from '../email/email-events.service';
import { InvoicesService } from '../invoices/invoices.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { BookingsService } from '../modules/bookings/bookings.service';
import { HousekeepingService } from '../modules/housekeeping/housekeeping.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

describe('Booking -> Checkout -> Housekeeping integration flow', () => {
  let bookingsService: BookingsService;
  let housekeepingService: HousekeepingService;

  const prismaMock = {
    property: {
      findFirst: jest.fn(),
    },
    room: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    booking: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    guest: {
      findFirst: jest.fn(),
    },
    invoices: {
      findFirst: jest.fn(),
    },
    housekeepingTask: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
  };

  const emailEventsServiceMock = {
    onBookingCreated: jest.fn().mockResolvedValue(undefined),
    onBookingCheckout: jest.fn().mockResolvedValue(undefined),
    sendReviewRequest: jest.fn().mockResolvedValue(undefined),
  };

  const auditLogServiceMock = {
    logBookingCreate: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue(undefined),
    logHousekeepingTaskCompletion: jest.fn().mockResolvedValue(undefined),
  };

  const invoicesServiceMock = {};
  const loyaltyServiceMock = {
    addPointsForStay: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsServiceMock = {
    create: jest.fn().mockResolvedValue(undefined),
  };
  const paymentsServiceMock = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        HousekeepingService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailEventsService, useValue: emailEventsServiceMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: LoyaltyService, useValue: loyaltyServiceMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
      ],
    }).compile();

    bookingsService = module.get(BookingsService);
    housekeepingService = module.get(HousekeepingService);

    jest.clearAllMocks();
    jest.spyOn(bookingsService as any, 'generateBookingInvoice').mockResolvedValue(undefined);
    jest.spyOn(bookingsService as any, 'finalizeCheckoutInvoice').mockResolvedValue(undefined);
    jest.spyOn(bookingsService as any, 'trackAnalytics').mockResolvedValue(undefined);
  });

  it('creates a booking, checks it out, then completes the housekeeping task and reopens the room', async () => {
    const now = new Date('2026-04-05T10:30:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prismaMock.property.findFirst.mockResolvedValue({
      id: 'property-1',
      tenantId: 'tenant-1',
      standardCheckInTime: '14:00',
      standardCheckOutTime: '11:00',
    });
    prismaMock.room.findFirst.mockResolvedValue({
      id: 'room-1',
      propertyId: 'property-1',
      tenantId: 'tenant-1',
      number: '101',
      price: 1500,
      property: { id: 'property-1' },
    });
    prismaMock.booking.findFirst.mockResolvedValueOnce(null);
    prismaMock.booking.create.mockImplementation(async ({ data }) => ({
      id: 'booking-1',
      ...data,
      guest: null,
      room: { id: 'room-1', number: '101' },
      property: { id: 'property-1' },
    }));

    const booking = await bookingsService.create(
      {
        propertyId: 'property-1',
        roomId: 'room-1',
        guestFirstName: 'Mina',
        guestLastName: 'Park',
        checkIn: '2026-04-10',
        checkOut: '2026-04-12',
      } as any,
      'tenant-1',
    );

    expect(booking.status).toBe('pending');
    expect(prismaMock.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledCheckIn: new Date('2026-04-10T14:00:00.000Z'),
          scheduledCheckOut: new Date('2026-04-12T11:00:00.000Z'),
        }),
      }),
    );

    jest.spyOn(bookingsService, 'findOne').mockResolvedValue({
      id: 'booking-1',
      status: 'checked_in',
      guestId: 'guest-1',
      guestFirstName: 'Mina',
      guestLastName: 'Park',
      roomId: 'room-1',
      room: { id: 'room-1', number: '101' },
      totalPrice: 3000,
      checkIn: new Date('2026-04-10T00:00:00.000Z'),
      checkOut: new Date('2026-04-12T00:00:00.000Z'),
      actualCheckIn: new Date('2026-04-10T14:00:00.000Z'),
    } as any);
    prismaMock.booking.update.mockResolvedValue({
      id: 'booking-1',
      status: 'checked_out',
      actualCheckOut: now,
      guestFirstName: 'Mina',
      guestLastName: 'Park',
      room: { id: 'room-1', number: '101' },
      property: { id: 'property-1' },
    });
    prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'cleaning' });
    prismaMock.housekeepingTask.create.mockImplementation(async ({ data }) => ({
      id: 'hk-1',
      ...data,
      room: { id: 'room-1', number: '101' },
    }));

    const checkedOutBooking = await bookingsService.checkOut('booking-1', 'tenant-1');

    expect(checkedOutBooking.status).toBe('checked_out');
    expect(prismaMock.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { status: 'cleaning' },
    });
    expect(prismaMock.housekeepingTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 'room-1',
        type: 'checkout',
        priority: 'high',
        tenantId: 'tenant-1',
      }),
    });

    prismaMock.housekeepingTask.findFirst.mockResolvedValue({
      id: 'hk-1',
      roomId: 'room-1',
      tenantId: 'tenant-1',
      status: 'in_progress',
      actualStartTime: new Date('2026-04-05T10:00:00.000Z'),
      room: { id: 'room-1', number: '101' },
    });
    prismaMock.housekeepingTask.update.mockImplementation(async ({ data }) => ({
      id: 'hk-1',
      roomId: 'room-1',
      ...data,
      room: { id: 'room-1', number: '101' },
      assignedTo: null,
    }));
    prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'available' });

    const completedTask = await housekeepingService.completeTask(
      'hk-1',
      100,
      'Room is ready for the next guest',
      'tenant-1',
    );

    expect(completedTask.status).toBe('completed');
    expect(completedTask.roomReadyAt).toEqual(now);
    expect(auditLogServiceMock.logHousekeepingTaskCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'hk-1',
        previousStatus: 'in_progress',
      }),
      undefined,
      'tenant-1',
    );
    expect(prismaMock.room.update).toHaveBeenLastCalledWith({
      where: { id: 'room-1' },
      data: { status: 'available' },
    });

    jest.useRealTimers();
  });
});
