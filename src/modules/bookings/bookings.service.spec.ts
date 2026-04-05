import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { EmailEventsService } from '../../email/email-events.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { TaskPriority, TaskType } from '../housekeeping/dto/create-housekeeping-task.dto';
import { BookingsService } from './bookings.service';

describe('BookingsService', () => {
  let service: BookingsService;

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
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    guest: {
      findFirst: jest.fn(),
    },
    invoices: {
      findFirst: jest.fn(),
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
  };

  const housekeepingServiceMock = {
    createTask: jest.fn().mockResolvedValue(undefined),
  };

  const loyaltyServiceMock = {
    addPointsForStay: jest.fn().mockResolvedValue(undefined),
  };

  const notificationsServiceMock = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const paymentsServiceMock = {};
  const invoicesServiceMock = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmailEventsService, useValue: emailEventsServiceMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: HousekeepingService, useValue: housekeepingServiceMock },
        { provide: LoyaltyService, useValue: loyaltyServiceMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
      ],
    }).compile();

    service = module.get(BookingsService);
    jest.clearAllMocks();
    jest.spyOn(service as any, 'generateBookingInvoice').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'finalizeCheckoutInvoice').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'trackAnalytics').mockResolvedValue(undefined);
  });

  describe('create', () => {
    it('normalizes frontend booking aliases before creating the booking', async () => {
      prismaMock.property.findFirst.mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: 'tenant-1',
        standardCheckInTime: '14:00',
        standardCheckOutTime: '12:00',
      });
      prismaMock.room.findFirst.mockResolvedValue({
        id: '550e8400-e29b-41d4-a716-446655440001',
        tenantId: 'tenant-1',
        propertyId: '550e8400-e29b-41d4-a716-446655440000',
        price: 2000,
      });
      prismaMock.booking.findFirst.mockResolvedValue(null);
      prismaMock.booking.create.mockImplementation(async ({ data }) => ({
        id: 'booking-1',
        ...data,
        guest: null,
        room: { id: '550e8400-e29b-41d4-a716-446655440001', number: '101' },
        property: { id: '550e8400-e29b-41d4-a716-446655440000' },
      }));

      const result = await service.create(
        {
          property: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            checkInTime: '14:00',
            checkOutTime: '12:00',
          },
          roomId: '550e8400-e29b-41d4-a716-446655440001',
          roomTypeIds: ['deluxe'],
          guestName: 'John Doe',
          checkInDate: '2026-04-10',
          checkOutDate: '2026-04-12',
        } as any,
        'tenant-1',
      );

      expect(prismaMock.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            propertyId: '550e8400-e29b-41d4-a716-446655440000',
            guestFirstName: 'John',
            guestLastName: 'Doe',
            checkIn: new Date('2026-04-10T00:00:00.000Z'),
            checkOut: new Date('2026-04-12T00:00:00.000Z'),
          }),
        }),
      );
      expect(result.checkInDate).toEqual(new Date('2026-04-10T00:00:00.000Z'));
      expect(result.checkOutDate).toEqual(new Date('2026-04-12T00:00:00.000Z'));
    });

    it('stores scheduled check-in/check-out using property time settings for date-only input', async () => {
      prismaMock.property.findFirst.mockResolvedValue({
        id: 'property-1',
        tenantId: 'tenant-1',
        standardCheckInTime: '15:00',
        standardCheckOutTime: '12:00',
      });
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        price: 2000,
      });
      prismaMock.booking.findFirst.mockResolvedValue(null);
      prismaMock.booking.create.mockImplementation(async ({ data }) => ({
        id: 'booking-1',
        ...data,
        guest: null,
        room: { id: 'room-1', number: '101' },
        property: { id: 'property-1' },
      }));

      const result = await service.create(
        {
          propertyId: 'property-1',
          roomId: 'room-1',
          guestFirstName: 'John',
          guestLastName: 'Doe',
          checkIn: '2026-04-10',
          checkOut: '2026-04-12',
        } as any,
        'tenant-1',
      );

      expect(prismaMock.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scheduledCheckIn: new Date('2026-04-10T15:00:00.000Z'),
            scheduledCheckOut: new Date('2026-04-12T12:00:00.000Z'),
            totalPrice: 4000,
          }),
        }),
      );
      expect(result.checkInDate).toEqual(new Date('2026-04-10T00:00:00.000Z'));
      expect(result.checkOutDate).toEqual(new Date('2026-04-12T00:00:00.000Z'));
    });

    it('throws when room already has an overlapping active booking', async () => {
      prismaMock.property.findFirst.mockResolvedValue({
        id: 'property-1',
        tenantId: 'tenant-1',
      });
      prismaMock.room.findFirst.mockResolvedValue({
        id: 'room-1',
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        price: 2000,
      });
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'existing-booking' });

      await expect(
        service.create(
          {
            propertyId: 'property-1',
            roomId: 'room-1',
            guestFirstName: 'John',
            guestLastName: 'Doe',
            checkIn: '2026-04-10',
            checkOut: '2026-04-12',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checkOut', () => {
    it('marks booking checked out, sets room to cleaning, and creates a checkout housekeeping task', async () => {
      const now = new Date('2026-04-05T10:30:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'booking-1',
        status: 'checked_in',
        guestId: 'guest-1',
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        roomId: 'room-1',
        room: { id: 'room-1', number: '101' },
        totalPrice: 3000,
        checkIn: new Date('2026-04-01T00:00:00.000Z'),
        checkOut: new Date('2026-04-05T00:00:00.000Z'),
        actualCheckIn: new Date('2026-04-01T14:00:00.000Z'),
      } as any);
      prismaMock.booking.update.mockResolvedValue({
        id: 'booking-1',
        status: 'checked_out',
        actualCheckOut: now,
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        room: { id: 'room-1', number: '101' },
        property: { id: 'property-1' },
      });
      prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'cleaning' });

      const result = await service.checkOut('booking-1', 'tenant-1');

      expect(prismaMock.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: {
          status: 'checked_out',
          actualCheckOut: now,
        },
        include: { guest: true, room: true, property: true },
      });
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'cleaning' },
      });
      expect(housekeepingServiceMock.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          type: TaskType.CHECKOUT,
          priority: TaskPriority.HIGH,
        }),
        'tenant-1',
      );
      expect(result.status).toBe('checked_out');

      jest.useRealTimers();
    });

    it('rejects checkout when booking is not checked in', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'booking-1',
        status: 'confirmed',
      } as any);

      await expect(service.checkOut('booking-1', 'tenant-1')).rejects.toThrow(BadRequestException);
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
    });

    it('throws when tenantId is missing via findOne', async () => {
      jest.spyOn(service, 'findOne').mockRejectedValue(new NotFoundException('Booking not found'));

      await expect(service.checkOut('booking-404')).rejects.toThrow(NotFoundException);
    });
  });
});
