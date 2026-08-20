import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { TaskPriority, TaskType } from '../housekeeping/dto/create-housekeeping-task.dto';
import { RevenuePostingService } from '../revenue/revenue-posting.service';
import {
  buildRevenuePostingStub,
  postedRevenueInput,
  type RevenuePostingStub,
} from '../revenue/__tests__/revenue-posting.stub';
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
    housekeepingTask: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    // เช็คเอาต์กับลงสมุดรายได้อยู่ในทรานแซกชันเดียวกัน — mock ส่ง client ตัวเดิม
    // กลับไปให้ callback ทำงานจริง ไม่งั้นการเขียนทั้งก้อนจะหายไปเงียบ ๆ
    $transaction: jest.fn(async (run: (tx: unknown) => unknown) => run(prismaMock)),
  };

  const emailEventsServiceMock = {
    onBookingCreated: jest.fn().mockResolvedValue(undefined),
    onBookingCheckout: jest.fn().mockResolvedValue(undefined),
    onBookingCancelled: jest.fn().mockResolvedValue(undefined),
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
    reverseStayAward: jest.fn().mockResolvedValue(null),
  };

  const notificationsServiceMock = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const paymentsServiceMock = {};
  const invoicesServiceMock = {};
  let revenuePostingMock: RevenuePostingStub;
  const eventEmitterMock = {
    emit: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    revenuePostingMock = buildRevenuePostingStub();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
        { provide: EmailEventsService, useValue: emailEventsServiceMock },
        { provide: AuditLogService, useValue: auditLogServiceMock },
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: HousekeepingService, useValue: housekeepingServiceMock },
        { provide: LoyaltyService, useValue: loyaltyServiceMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
        { provide: RevenuePostingService, useValue: revenuePostingMock },
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
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
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

      // Times are interpreted in Bangkok timezone (UTC+7), so 15:00 BKK = 08:00 UTC.
      // This matches buildScheduledDateTime which appends +07:00 to date-only strings.
      expect(prismaMock.booking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            scheduledCheckIn: new Date('2026-04-10T08:00:00.000Z'),
            scheduledCheckOut: new Date('2026-04-12T05:00:00.000Z'),
            totalPrice: 4000,
          }),
        }),
      );
      expect(result.checkInDate).toEqual(new Date('2026-04-10T00:00:00.000Z'));
      expect(result.checkOutDate).toEqual(new Date('2026-04-12T00:00:00.000Z'));
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
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
    it('marks booking checked out, sets room to dirty, and creates a checkout housekeeping task', async () => {
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
        totalPrice: 3000,
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
      // dirty = ออกแล้วรอมอบหมายแม่บ้าน / cleaning = แม่บ้านรับงานแล้ว
      // (เช็คเอาต์ยังไม่ได้มอบหมายงาน สถานะจึงเป็น dirty ไม่ใช่ cleaning)
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'dirty' },
      });
      expect(housekeepingServiceMock.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          type: TaskType.CHECKOUT,
          priority: TaskPriority.HIGH,
        }),
        'tenant-1',
      );
      expect(eventEmitterMock.emit).toHaveBeenCalledWith('booking.checked_out', {
        bookingId: 'booking-1',
        tenantId: 'tenant-1',
        guestId: 'guest-1',
        totalAmount: 3000,
      });
      expect(loyaltyServiceMock.addPointsForStay).not.toHaveBeenCalled();
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

  /**
   * ย้อนสถานะเช็คเอาต์ — ทางกลับของประตูทางเดียว
   *
   * ที่ต้องตรึงไว้คือ "ขอบเขต" ไม่ใช่แค่ว่ามันย้อนได้: ข้ามวันทำการไทยแล้วต้องไม่ยอม
   * (ไม่งั้นยอดของวันที่ปิดไปแล้วขยับ และเช็คเอาต์รอบต่อไปจะลงสมุดไม่ได้อีกเลย)
   * และห้องที่ขายต่อไปแล้วต้องไม่ยอม (ไม่งั้นแขกสองรายอยู่ห้องเดียวกันบนกระดาษ)
   */
  describe('undoCheckOut', () => {
    const BANGKOK_AFTERNOON = new Date('2026-04-05T10:30:00.000Z'); // 17:30 ตามเวลาไทย
    const CHECKED_OUT_TODAY = new Date('2026-04-05T04:00:00.000Z'); // 11:00 ตามเวลาไทย วันเดียวกัน

    const checkedOutBooking = (overrides: Record<string, unknown> = {}) => ({
      id: 'booking-1',
      status: 'checked_out',
      guestId: 'guest-1',
      guestFirstName: 'Jane',
      guestLastName: 'Doe',
      roomId: 'room-1',
      room: { id: 'room-1', number: '101' },
      checkIn: new Date('2026-04-04T00:00:00.000Z'),
      checkOut: new Date('2026-04-06T00:00:00.000Z'),
      actualCheckIn: new Date('2026-04-04T07:00:00.000Z'),
      actualCheckOut: CHECKED_OUT_TODAY,
      ...overrides,
    });

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(BANGKOK_AFTERNOON);
      prismaMock.booking.findFirst.mockResolvedValue(null);
      prismaMock.housekeepingTask.findMany.mockResolvedValue([]);
      prismaMock.booking.update.mockResolvedValue({
        id: 'booking-1',
        status: 'checked_in',
        actualCheckOut: null,
        guestFirstName: 'Jane',
        guestLastName: 'Doe',
        room: { id: 'room-1', number: '101' },
        property: { id: 'property-1' },
      });
      prismaMock.room.update.mockResolvedValue({ id: 'room-1', status: 'occupied' });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('puts the guest back in the room and pulls the revenue in the same transaction', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(checkedOutBooking() as any);
      prismaMock.housekeepingTask.findMany.mockResolvedValue([
        { id: 'hk-1', status: 'pending', assignedToId: null },
      ]);

      const result = await service.undoCheckOut('booking-1', 'tenant-1', 'user-9', 'กดผิดห้อง');

      expect(prismaMock.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'checked_in', actualCheckOut: null },
        include: { guest: true, room: true, property: true },
      });
      expect(revenuePostingMock.voidWithin).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          tenantId: 'tenant-1',
          sourceType: 'BOOKING',
          sourceId: 'booking-1',
          voidedBy: 'user-9',
        }),
      );
      // งานที่ยังไม่มีใครรับต้องหายไปจากบอร์ด ไม่งั้นแม่บ้านเดินไปเคาะห้องที่มีคนอยู่
      expect(prismaMock.housekeepingTask.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', id: { in: ['hk-1'] } },
      });
      expect(prismaMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { status: 'occupied' },
      });
      expect(auditLogServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'booking_checkout_undo', resourceId: 'booking-1' }),
      );
      expect(loyaltyServiceMock.reverseStayAward).toHaveBeenCalledWith(
        'tenant-1',
        'guest-1',
        'booking-1',
      );
      expect(result.status).toBe('checked_in');
      expect(result.undo.housekeepingTasksRemoved).toBe(1);
      expect(result.undo.warnings).toEqual([]);
    });

    it('keeps a task the housekeeper already started and says so', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(checkedOutBooking() as any);
      prismaMock.housekeepingTask.findMany.mockResolvedValue([
        { id: 'hk-1', status: 'in_progress', assignedToId: 'staff-1' },
      ]);

      const result = await service.undoCheckOut('booking-1', 'tenant-1', 'user-9');

      expect(prismaMock.housekeepingTask.deleteMany).not.toHaveBeenCalled();
      expect(result.undo.housekeepingTasksKept).toBe(1);
      expect(result.undo.warnings).toHaveLength(1);
    });

    it('refuses once the Bangkok business day has rolled over', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(
        checkedOutBooking({ actualCheckOut: new Date('2026-04-04T10:00:00.000Z') }) as any,
      );

      await expect(service.undoCheckOut('booking-1', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
      expect(revenuePostingMock.voidWithin).not.toHaveBeenCalled();
    });

    it('refuses when the room has already been sold to someone else', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(checkedOutBooking() as any);
      prismaMock.booking.findFirst.mockResolvedValue({ id: 'booking-2', bookingNo: 'BK-002' });

      await expect(service.undoCheckOut('booking-1', 'tenant-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
    });

    it('refuses a booking that is not checked out', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(
        checkedOutBooking({ status: 'checked_in', actualCheckOut: null }) as any,
      );

      await expect(service.undoCheckOut('booking-1', 'tenant-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
    });
  });

  /**
   * สมุดรายได้กลาง — ค่าห้องเข้าสมุดตอนเช็คเอาต์ ยกเลิกแล้วต้องดึงกลับ
   *
   * ยอดจริงถูกพิสูจน์กับฐานข้อมูลจริงใน `scripts/verify-revenue-ledger.ts` ที่นี่
   * ตรึงว่าใบไหน แตกยอดเป็นบรรทัดอะไร และเขียนใน tx เดียวกับที่ปิดสถานะการจอง
   */
  describe('revenue ledger', () => {
    /** การจองที่เช็คอินอยู่ พร้อมให้กดเช็คเอาต์ */
    const stayInHouse = () =>
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'booking-1',
        status: 'checked_in',
        guestId: 'guest-1',
        roomId: 'room-1',
        room: { id: 'room-1', number: '101' },
        totalPrice: 3000,
        checkIn: new Date('2026-04-01T00:00:00.000Z'),
        checkOut: new Date('2026-04-05T00:00:00.000Z'),
        actualCheckIn: new Date('2026-04-01T14:00:00.000Z'),
      } as any);

    /** แถวที่ booking.update คืนกลับมาให้ตัวแปลงรายได้ */
    const checkedOutRow = (over: Record<string, unknown> = {}) => ({
      id: 'booking-1',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      bookingNo: 'BK-0001',
      paymentMethod: 'transfer',
      status: 'checked_out',
      checkOut: new Date('2026-04-05T00:00:00.000Z'),
      actualCheckOut: new Date('2026-04-05T10:30:00.000Z'),
      totalPrice: 3000,
      roomSubtotal: 3000,
      serviceChargeAmount: 0,
      vatAmount: 0,
      grandTotal: 3000,
      room: { id: 'room-1', number: '101' },
      property: { id: 'property-1' },
      ...over,
    });

    it('posts the room revenue in the same transaction that closes the stay', async () => {
      stayInHouse();
      prismaMock.booking.update.mockResolvedValue(checkedOutRow());
      prismaMock.invoices.findFirst.mockResolvedValue(null);

      await service.checkOut('booking-1', 'tenant-1');

      expect(revenuePostingMock.postWithin).toHaveBeenCalledTimes(1);
      expect(revenuePostingMock.postWithin.mock.calls[0][0]).toBe(prismaMock);
      expect(postedRevenueInput(revenuePostingMock)).toMatchObject({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        sourceModule: 'HOTEL',
        sourceType: 'BOOKING',
        sourceId: 'booking-1',
        documentNo: 'BK-0001',
        settlement: 'TRANSFER',
        lines: [{ revenueType: 'ROOM', grossAmount: 3000, taxAmount: 0 }],
      });
    });

    it('splits service charge onto its own line and shares VAT across both', async () => {
      stayInHouse();
      prismaMock.booking.update.mockResolvedValue(
        checkedOutRow({
          roomSubtotal: 3000,
          serviceChargeAmount: 300,
          vatAmount: 231, // 7% ของ 3300
          grandTotal: 3531,
        }),
      );
      prismaMock.invoices.findFirst.mockResolvedValue(null);

      await service.checkOut('booking-1', 'tenant-1');

      expect(postedRevenueInput(revenuePostingMock).lines).toEqual([
        { revenueType: 'ROOM', grossAmount: 3000, taxAmount: 210 },
        { revenueType: 'SERVICE_CHARGE', grossAmount: 300, taxAmount: 21 },
      ]);
    });

    it('adds invoice extras as OTHER — POS room charges are not counted twice here', async () => {
      stayInHouse();
      prismaMock.booking.update.mockResolvedValue(checkedOutRow());
      prismaMock.invoices.findFirst.mockResolvedValue({
        invoice_items: [{ amount: 500 }, { amount: 250 }],
      });

      await service.checkOut('booking-1', 'tenant-1');

      expect(postedRevenueInput(revenuePostingMock).lines).toEqual([
        { revenueType: 'ROOM', grossAmount: 3000, taxAmount: 0 },
        { revenueType: 'OTHER', grossAmount: 750 },
      ]);
    });

    it('pulls the revenue back when a booking is cancelled', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'booking-1',
        status: 'checked_out',
        roomId: 'room-1',
      } as any);
      prismaMock.booking.update.mockResolvedValue({
        id: 'booking-1',
        status: 'cancelled',
        property: { id: 'property-1' },
        room: { id: 'room-1', number: '101' },
      });

      await service.remove('booking-1', 'tenant-1', 'user-9');

      expect(revenuePostingMock.voidWithin).toHaveBeenCalledTimes(1);
      expect(revenuePostingMock.voidWithin.mock.calls[0][0]).toBe(prismaMock);
      expect(revenuePostingMock.voidWithin.mock.calls[0][1]).toMatchObject({
        tenantId: 'tenant-1',
        sourceType: 'BOOKING',
        sourceId: 'booking-1',
        voidedBy: 'user-9',
      });
    });
  });
});
