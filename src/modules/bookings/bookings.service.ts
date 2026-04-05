import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailEventsService } from '../../email/email-events.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuditAction, AuditResource } from '../../audit-log/dto/audit-log.dto';
import { InvoicesService } from '../../invoices/invoices.service';
import { InvoiceStatus } from '../../invoices/entities/invoice.entity';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { LoyaltyService } from '../../loyalty/loyalty.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { TaskType, TaskPriority } from '../housekeeping/dto/create-housekeeping-task.dto';
import { PaymentsService } from '../../payments/payments.service';
import { PaymentMethod, PaymentStatus } from '../../payments/entities/payment.entity';
import { Prisma } from '@prisma/client';

/** Map frontend booking payment options to the payments module enum. */
function mapToPaymentsMethod(frontendMethod?: string): PaymentMethod | null {
  switch (frontendMethod) {
    case 'PROMPTPAY':
      return PaymentMethod.QR;
    case 'BANK_TRANSFER':
      return PaymentMethod.TRANSFER;
    case 'CASH':
      return PaymentMethod.CASH;
    case 'PAY_AT_HOTEL':
      return PaymentMethod.CASH;
    case 'CREDIT_CARD':
      return PaymentMethod.TRANSFER; // fallback until card gateway support is added
    default:
      return null;
  }
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private emailEventsService: EmailEventsService,
    private auditLogService: AuditLogService,
    private invoicesService: InvoicesService,
    private housekeepingService: HousekeepingService,
    private loyaltyService: LoyaltyService,
    private notificationsService: NotificationsService,
    private paymentsService: PaymentsService,
  ) {}

  private parseBookingDate(value: string, fieldName: 'checkIn' | 'checkOut'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO 8601 date`);
    }
    return parsed;
  }

  private buildScheduledDateTime(value: string, fallbackTime: string): Date {
    if (value.includes('T')) {
      return new Date(value);
    }

    const [hours, minutes] = fallbackTime.split(':').map(Number);
    const date = new Date(`${value}T00:00:00.000Z`);
    date.setUTCHours(hours, minutes, 0, 0);
    return date;
  }

  /**
   * Transform raw Prisma booking record to the response shape expected by the frontend.
   * Adds alias fields (checkInDate, checkOutDate, totalAmount) and computed fields
   * (numberOfNights, numberOfRooms, bookingNumber) so the UI always receives consistent data.
   */
  private mapBookingResponse(booking: any): any {
    const nights =
      booking.checkIn && booking.checkOut
        ? Math.max(
            0,
            Math.ceil(
              (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
                (1000 * 60 * 60 * 24),
            ),
          )
        : 0;

    return {
      ...booking,
      // Alias fields — frontend uses checkInDate / checkOutDate
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      // totalAmount — frontend field; convert Prisma Decimal to number
      totalAmount: Number(booking.totalPrice ?? 0),
      // Computed fields (current schema: 1 room per booking record)
      numberOfRooms: 1,
      numberOfNights: nights,
      // Short human-readable booking reference
      bookingNumber: booking.id ? booking.id.slice(0, 8).toUpperCase() : '-',
    };
  }

  /**
   * Track analytics event
   * Called when important booking events occur
   */
  private async trackAnalytics(
    tenantId: string | undefined,
    eventName: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (!tenantId) {
        this.logger.warn(`Cannot track analytics: tenantId missing for event ${eventName}`);
        return;
      }
      // Log event for analytics tracking (can be integrated with analytics service later)
      this.logger.log(
        `Analytics Event: ${eventName} | Tenant: ${tenantId} | Data: ${JSON.stringify(eventData)}`,
      );
    } catch (error) {
      this.logger.error(`Failed to track analytics event ${eventName}: ${error.message}`);
      // Don't throw - analytics should not block main flow
    }
  }

  async findAll(query: any, tenantId?: string) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, guestId, roomId, propertyId, search } = query;
    const skip = (page - 1) * limit;

    // tenantId is required for data isolation
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { tenantId };
    if (status) where.status = status;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;
    if (propertyId) where.propertyId = propertyId;

    if (search) {
      where.OR = [
        { guestFirstName: { contains: search } },
        { guestLastName: { contains: search } },
        { guestEmail: { contains: search } },
        { room: { number: { contains: search } } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.booking.findMany({
          where,
          skip,
          take: limit,
          include: {
            guest: true,
            room: true,
            property: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.booking.count({ where }),
      ]);

      return {
        data: data.map((b) => this.mapBookingResponse(b)),
        total,
        page,
        limit,
      };
    } catch (error) {
      // ถ้าเกิด database error (table/column ไม่มี) ให้ส่ง empty data สำหรับผู้ใช้ใหม่
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return {
            data: [],
            total: 0,
            page,
            limit,
          };
        }
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

    const booking = await this.prisma.booking.findFirst({
      where,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }

    return this.mapBookingResponse(booking);
  }

  async create(createBookingDto: CreateBookingDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { propertyId, roomId, guestId, checkIn, checkOut } = createBookingDto;
    const checkInDate = this.parseBookingDate(checkIn, 'checkIn');
    const checkOutDate = this.parseBookingDate(checkOut, 'checkOut');

    // Validate dates
    if (checkOutDate <= checkInDate) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    // Verify property belongs to tenant
    const propertyWhere: any = { id: propertyId, tenantId };
    const property = await this.prisma.property.findFirst({
      where: propertyWhere,
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Verify room belongs to property and tenant
    const roomWhere: any = { id: roomId, propertyId, tenantId };
    const room = await this.prisma.room.findFirst({
      where: roomWhere,
    });

    if (!room) {
      throw new NotFoundException('Room not found in this property');
    }

    // Check room availability — include pending so double-booking is blocked immediately
    const bookingScope: any = {
      roomId,
      tenantId,
      status: { in: ['pending', 'confirmed', 'checked_in'] },
      OR: [
        {
          checkIn: { lte: checkOutDate },
          checkOut: { gte: checkInDate },
        },
      ],
    };

    const existingBooking = await this.prisma.booking.findFirst({
      where: bookingScope,
    });

    if (existingBooking) {
      throw new BadRequestException('Room is not available for the selected dates');
    }

    // If guestId provided, verify it exists and optionally auto-fill guest data
    if (guestId) {
      const guestWhere: any = { id: guestId, tenantId };
      const guest = await this.prisma.guest.findFirst({
        where: guestWhere,
      });

      if (!guest) {
        throw new NotFoundException('Guest not found');
      }

      // Auto-populate guest data from Guest record if not provided
      if (!createBookingDto.guestFirstName) {
        createBookingDto.guestFirstName = guest.firstName;
      }
      if (!createBookingDto.guestLastName) {
        createBookingDto.guestLastName = guest.lastName;
      }
      if (!createBookingDto.guestEmail && guest.email) {
        createBookingDto.guestEmail = guest.email;
      }
      if (!createBookingDto.guestPhone && guest.phone) {
        createBookingDto.guestPhone = guest.phone;
      }
    }

    // Calculate total price
    const nights = Math.ceil(
      (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const totalPrice = Number(room.price) * nights;

    // Extract paymentMethod for booking record + Payment record creation
    const rawPaymentMethod: string | undefined = createBookingDto.paymentMethod;

    // Prisma DateTime requires full ISO-8601 — convert date-only strings (YYYY-MM-DD)
    const toDateTime = (val: string): Date => {
      if (!val) return new Date();
      return val.includes('T') ? new Date(val) : new Date(`${val}T00:00:00.000Z`);
    };

    const data: any = {
      propertyId:     createBookingDto.propertyId,
      roomId:         createBookingDto.roomId,
      guestId:        createBookingDto.guestId || undefined,
      guestFirstName: createBookingDto.guestFirstName,
      guestLastName:  createBookingDto.guestLastName,
      guestEmail:     createBookingDto.guestEmail || undefined,
      guestPhone:     createBookingDto.guestPhone || undefined,
      checkIn:        toDateTime(createBookingDto.checkIn),
      checkOut:       toDateTime(createBookingDto.checkOut),
      scheduledCheckIn: this.buildScheduledDateTime(
        createBookingDto.checkIn,
        property.standardCheckInTime ?? '14:00',
      ),
      scheduledCheckOut: this.buildScheduledDateTime(
        createBookingDto.checkOut,
        property.standardCheckOutTime ?? '11:00',
      ),
      status:         createBookingDto.status || 'pending',
      notes:          createBookingDto.notes || undefined,
      channelId:      createBookingDto.channelId || undefined,
      paymentMethod:  rawPaymentMethod || undefined,
      paymentStatus:  rawPaymentMethod ? 'pending' : undefined,
      totalPrice,
      tenantId,
    };

    const booking = await this.prisma.booking.create({
      data,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    // Send booking confirmation email (async, non-blocking)
    this.emailEventsService.onBookingCreated(booking).catch((err) => {
      this.logger.error(`Failed to send booking confirmation email: ${err.message}`);
    });

    // Log booking creation (async, non-blocking)
    this.auditLogService
      .logBookingCreate(booking, 'system', undefined)
      .catch((err) => {
        this.logger.error(`Failed to log booking creation: ${err.message}`);
      });

    // Auto-generate invoice + payment record (async, non-blocking)
    this.generateBookingInvoice(booking, rawPaymentMethod).catch((err) => {
      this.logger.error(`Failed to auto-generate invoice for booking ${booking.id}: ${err.message}`);
    });

    // Track analytics event (async, non-blocking)
    this.trackAnalytics(tenantId, 'booking_created', {
      bookingId: booking.id,
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomId: booking.roomId,
      propertyId: booking.propertyId,
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      totalPrice: booking.totalPrice,
    }).catch((err) => {
      this.logger.error(`Failed to track booking_created event: ${err.message}`);
    });

    return this.mapBookingResponse(booking);
  }

  async update(id: string, updateBookingDto: any, tenantId?: string) {
    await this.findOne(id, tenantId);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: updateBookingDto,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    return this.mapBookingResponse(updated);
  }

  async checkIn(id: string, tenantId?: string) {
    const booking = await this.findOne(id, tenantId);

    if (booking.status === 'checked_in') {
      throw new BadRequestException('Booking is already checked in');
    }
    if (booking.status === 'cancelled') {
      throw new BadRequestException('Cannot check in a cancelled booking');
    }
    if (booking.status === 'checked_out') {
      throw new BadRequestException('Booking is already checked out');
    }

    // Check for early/late arrival
    const checkInDate = new Date(booking.checkIn);
    const actualCheckIn = new Date();
    const daysEarly = Math.floor((checkInDate.getTime() - actualCheckIn.getTime()) / (1000 * 60 * 60 * 24));
    const daysLate = Math.floor((actualCheckIn.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysEarly > 1) {
      this.logger.warn(
        `Early check-in: Guest ${booking.guestFirstName} ${booking.guestLastName} is checking in ${daysEarly} days early for booking ${booking.id}`,
      );
    } else if (daysLate > 1) {
      this.logger.warn(
        `Late check-in: Guest ${booking.guestFirstName} ${booking.guestLastName} is checking in ${daysLate} days late for booking ${booking.id}`,
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'checked_in',
        actualCheckIn: new Date(),
      },
      include: { guest: true, room: true, property: true },
    });

    // Update room status to occupied
    if (booking.roomId) {
      await this.prisma.room
        .update({
          where: { id: booking.roomId },
          data: { status: 'occupied' },
        })
        .catch(() => {});
    }

    // Log check-in action
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_CHECKIN,
        resource: AuditResource.BOOKING,
        resourceId: booking.id,
        newValues: {
          status: 'checked_in',
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          roomNumber: booking.room?.number,
          actualCheckIn: updated.actualCheckIn,
        },
        oldValues: {
          status: booking.status,
        },
        tenantId,
        description: `Guest ${booking.guestFirstName} ${booking.guestLastName} checked in to Room ${booking.room?.number || 'N/A'}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log check-in: ${err.message}`);
      });

    // Track analytics event (async, non-blocking)
    this.trackAnalytics(tenantId, 'check_in', {
      bookingId: booking.id,
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomNumber: booking.room?.number,
      actualCheckInTime: updated.actualCheckIn,
      scheduledCheckInDate: booking.checkIn,
    }).catch((err) => {
      this.logger.error(`Failed to track check_in event: ${err.message}`);
    });

    // Create check-in notification (async, non-blocking)
    this.notificationsService
      .create({
        title: 'Guest Checked In',
        message: `${booking.guestFirstName} ${booking.guestLastName} checked in to Room ${booking.room?.number || 'N/A'}`,
        type: 'check_in',
        tenantId,
      })
      .catch((err) => {
        this.logger.error(`Failed to create check-in notification: ${err.message}`);
      });

    // Send check-in confirmation email (async, non-blocking)
    this.emailEventsService
      .onBookingCheckIn(updated)
      .catch((err) => {
        this.logger.error(`Failed to send check-in confirmation email: ${err.message}`);
      });

    return this.mapBookingResponse(updated);
  }

  async checkOut(id: string, tenantId?: string): Promise<any> {
    const booking = await this.findOne(id, tenantId);

    if (booking.status !== 'checked_in') {
      throw new BadRequestException('Booking must be checked in before check out');
    }

    const now = new Date();
    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: 'checked_out',
        actualCheckOut: now,
      },
      include: { guest: true, room: true, property: true },
    });

    // Update room status to cleaning
    if (booking.roomId) {
      await this.prisma.room
        .update({
          where: { id: booking.roomId },
          data: { status: 'cleaning' },
        })
        .catch(() => {});
    }

    // Finalize invoice (calculate actual stay duration)
    const stayDuration = Math.ceil(
      (now.getTime() - new Date(booking.actualCheckIn || booking.checkIn).getTime()) / (1000 * 60 * 60 * 24),
    );

    this.logger.debug(`Checkout for booking ${id}: actual stay duration ${stayDuration} nights`);

    // Finalize invoice with actual charges (async, non-blocking)
    this.finalizeCheckoutInvoice(id, tenantId, booking).catch((err) => {
      this.logger.error(`Failed to finalize invoice on checkout: ${err.message}`);
    });

    // Log checkout action (async, non-blocking)
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_CHECKOUT,
        resource: AuditResource.BOOKING,
        resourceId: booking.id,
        newValues: {
          status: 'checked_out',
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          roomNumber: booking.room?.number,
          actualCheckOut: updated.actualCheckOut,
          stayDuration: `${stayDuration} nights`,
        },
        oldValues: {
          status: booking.status,
        },
        tenantId,
        description: `Guest ${booking.guestFirstName} ${booking.guestLastName} checked out from Room ${booking.room?.number || 'N/A'} after ${stayDuration} nights`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log checkout: ${err.message}`);
      });

    // Send checkout email (async, non-blocking)
    this.emailEventsService
      .onBookingCheckout(updated)
      .catch((err) => {
        this.logger.error(`Failed to send checkout email: ${err.message}`);
      });

    // Track analytics event (async, non-blocking)
    this.trackAnalytics(tenantId, 'check_out', {
      bookingId: booking.id,
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomNumber: booking.room?.number,
      actualCheckOutTime: updated.actualCheckOut,
      scheduledCheckOutDate: booking.checkOut,
      stayDurationDays: stayDuration,
    }).catch((err) => {
      this.logger.error(`Failed to track check_out event: ${err.message}`);
    });

    // Stage 6: Auto-create housekeeping task (async, non-blocking)
    if (booking.roomId) {
      this.housekeepingService
        .createTask(
          {
            roomId: booking.roomId,
            type: TaskType.CHECKOUT,
            priority: TaskPriority.HIGH,
            notes: `Checkout cleaning - Guest: ${booking.guestFirstName} ${booking.guestLastName}, Room: ${booking.room?.number || 'N/A'}`,
            estimatedDuration: 45,
          },
          tenantId,
        )
        .catch((err) => {
          this.logger.error(`Failed to create housekeeping task: ${err.message}`);
        });
    }

    // Stage 6: Send review request email (async, non-blocking)
    this.emailEventsService
      .sendReviewRequest(updated)
      .catch((err) => {
        this.logger.error(`Failed to send review request email: ${err.message}`);
      });

    // Stage 6: Add loyalty points for the stay (async, non-blocking)
    if (booking.guestId && booking.totalPrice) {
      this.loyaltyService
        .addPointsForStay(booking.guestId, tenantId, Number(booking.totalPrice))
        .catch((err) => {
          this.logger.error(`Failed to add loyalty points: ${err.message}`);
        });
    }

    return this.mapBookingResponse(updated);
  }

  async getCheckoutSummary(id: string, tenantId?: string): Promise<any> {
    const booking = await this.findOne(id, tenantId);

    // Calculate stay duration
    const checkInDate = new Date(booking.actualCheckIn || booking.checkIn);
    const checkOutDate = booking.actualCheckOut ? new Date(booking.actualCheckOut) : new Date();
    const stayDuration = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));

    // Get room charges
    const roomCharge = Number(booking.totalPrice);

    // Fetch invoice with items and payments for actual charges
    const invoice = await this.prisma.invoices.findFirst({
      where: { booking_id: id, tenant_id: tenantId },
      include: { invoice_items: true, payments: true },
    });

    // Calculate additional charges from invoice items
    const additionalCharges = invoice?.invoice_items?.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    ) || 0;

    // Calculate subtotal and taxes
    const subtotal = roomCharge + additionalCharges;
    const taxRate = 0.07; // 7% VAT
    const taxes = Math.round(subtotal * taxRate * 100) / 100;
    const totalAmount = subtotal + taxes;

    // Calculate amount paid from approved payments
    const amountPaid = invoice?.payments
      ?.filter((p: any) => p.status === 'approved')
      ?.reduce((sum, p: any) => sum + Number(p.amount || 0), 0) || 0;

    const balanceRemaining = totalAmount - amountPaid;

    // Prepare summary object
    const summary = {
      booking: {
        id: booking.id,
        guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        roomNumber: booking.room?.number,
        roomType: booking.room?.type,
      },
      stay: {
        checkInDate: booking.checkIn,
        checkOutDate: booking.checkOut,
        actualCheckInDate: booking.actualCheckIn,
        actualCheckOutDate: booking.actualCheckOut,
        stayDuration: `${stayDuration} nights`,
        nightCount: stayDuration,
      },
      charges: {
        roomCharge,
        additionalCharges,
        subtotal,
        taxes,
        totalAmount,
      },
      payment: {
        status: booking.status === 'checked_out' ? 'pending' : 'pending',
        amountPaid,
        balanceRemaining: Math.max(0, balanceRemaining),
      },
    };

    return summary;
  }

  async remove(id: string, tenantId?: string) {
    const booking = await this.findOne(id, tenantId);

    const cancelledBooking = await this.prisma.booking.update({
      where: { id },
      data: { status: 'cancelled' },
      include: {
        property: true,
        room: true,
      },
    });

    // Send cancellation email (async, non-blocking)
    this.emailEventsService.onBookingCancelled(cancelledBooking).catch((err) => {
      this.logger.error(`Failed to send cancellation email: ${err.message}`);
    });

    return this.mapBookingResponse(cancelledBooking);
  }

  /**
   * Auto-generate invoice for booking
   * Called after booking creation
   */
  private async generateBookingInvoice(booking: any, rawPaymentMethod?: string): Promise<void> {
    if (!booking.tenantId) {
      this.logger.warn(`Cannot generate invoice for booking ${booking.id}: tenantId missing`);
      return;
    }

    try {
      const invoiceNo = this.generateInvoiceNumber();
      const dueDate = new Date(booking.checkIn);

      const invoice = await this.invoicesService.create({
        tenantId: booking.tenantId,
        bookingId: booking.id,
        invoiceNo,
        amount: Number(booking.totalPrice),
        status: InvoiceStatus.PENDING,
        dueDate,
      });

      this.logger.log(`Invoice ${invoiceNo} auto-generated for booking ${booking.id}`);

      // Create payment record if payment method was selected
      const mappedMethod = mapToPaymentsMethod(rawPaymentMethod);
      if (mappedMethod && invoice?.id) {
        try {
          await this.paymentsService.create({
            invoiceId: invoice.id,
            method: mappedMethod,
            status: PaymentStatus.PENDING,
          });
          this.logger.log(
            `Payment record created for booking ${booking.id} | method: ${rawPaymentMethod} → ${mappedMethod}`,
          );

          // For PAY_AT_HOTEL: create housekeeping task as payment reminder
          if (rawPaymentMethod === 'PAY_AT_HOTEL') {
            await this.housekeepingService.createTask(
              {
                roomId: booking.roomId,
                type: TaskType.INSPECTION,
                priority: TaskPriority.HIGH,
                notes: `Collect payment on check-in for booking ${booking.id.slice(0, 8)}. Guest: ${booking.guestFirstName} ${booking.guestLastName}. Amount: THB ${Number(booking.totalPrice).toLocaleString()}.`,
              },
              booking.tenantId,
            ).catch((e: Error) =>
              this.logger.warn(`Could not create payment collection task: ${e.message}`),
            );
          }
        } catch (paymentError) {
          // Non-blocking — don't fail the booking if payment record fails
          this.logger.error(
            `Failed to create payment record for booking ${booking.id}: ${paymentError.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to generate invoice for booking ${booking.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate invoice number: INV-{YYYYMMDD}-{random4digits}
   */
  private generateInvoiceNumber(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return `INV-${year}${month}${day}-${random}`;
  }

  /**
   * Finalize invoice after checkout
   * Calculate additional charges from invoice items and update invoice total
   */
  private async finalizeCheckoutInvoice(
    bookingId: string,
    tenantId?: string,
    booking?: any,
  ): Promise<void> {
    try {
      if (!tenantId) {
        return;
      }

      const invoice = await this.prisma.invoices.findFirst({
        where: { booking_id: bookingId, tenant_id: tenantId },
        include: { invoice_items: true },
      });

      if (!invoice) {
        this.logger.debug(`No invoice found for booking ${bookingId} on checkout`);
        return;
      }

      // Calculate total from invoice items
      const additionalCharges = invoice.invoice_items?.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      ) || 0;

      const roomCharge = booking?.totalPrice ? Number(booking.totalPrice) : Number(invoice.amount);
      const totalAmount = roomCharge + additionalCharges;

      await this.prisma.invoices.update({
        where: { id: invoice.id },
        data: {
          adjusted_amount: totalAmount,
          status: 'pending',
        },
      });

      this.logger.log(
        `Invoice ${invoice.invoice_no} finalized on checkout: room ${roomCharge} + additional ${additionalCharges} = ${totalAmount}`,
      );
    } catch (error) {
      this.logger.error(`Failed to finalize invoice on checkout for ${bookingId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Walk-in guest — create booking + check-in in one operation
   * Receptionist can register a guest and immediately check them into a room
   * Returns booking with guest and room information
   */
  async walkIn(
    walkInDto: any,
    tenantId?: string,
    defaultPropertyId?: string,
  ): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { guestFirstName, guestLastName, guestEmail, guestPhone, roomId, propertyId, nights, notes } = walkInDto;

    // Determine property ID
    const finalPropertyId = propertyId || defaultPropertyId;
    if (!finalPropertyId) {
      throw new BadRequestException('Property ID is required');
    }

    // Verify property belongs to tenant
    const property = await this.prisma.property.findFirst({
      where: { id: finalPropertyId, tenantId },
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Verify room belongs to property and tenant
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, propertyId: finalPropertyId, tenantId },
    });

    if (!room) {
      throw new NotFoundException('Room not found in this property');
    }

    // Check room availability
    const now = new Date();
    const checkOutDate = new Date();
    checkOutDate.setDate(checkOutDate.getDate() + nights);

    const existingBooking = await this.prisma.booking.findFirst({
      where: {
        roomId,
        tenantId,
        status: { in: ['pending', 'confirmed', 'checked_in'] },
        OR: [
          {
            checkIn: { lte: checkOutDate },
            checkOut: { gte: now },
          },
        ],
      },
    });

    if (existingBooking) {
      throw new BadRequestException('Room is not available for the selected dates');
    }

    // Find or create guest
    let guest = null;
    if (guestEmail) {
      guest = await this.prisma.guest.findFirst({
        where: { email: guestEmail, tenantId },
      });
    }

    if (!guest) {
      guest = await this.prisma.guest.create({
        data: {
          firstName: guestFirstName,
          lastName: guestLastName,
          email: guestEmail || null,
          phone: guestPhone || null,
          tenantId,
        },
      });
    }

    // Calculate total price
    const totalPrice = Number(room.price) * nights;

    // Create booking with checked-in status immediately
    const booking = await this.prisma.booking.create({
      data: {
        guestFirstName,
        guestLastName,
        guestEmail: guestEmail || null,
        guestPhone: guestPhone || null,
        guestId: guest.id,
        roomId,
        propertyId: finalPropertyId,
        checkIn: now,
        checkOut: checkOutDate,
        actualCheckIn: now,
        status: 'checked_in',
        totalPrice,
        notes: notes || null,
        tenantId,
      },
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    // Update room status to occupied
    await this.prisma.room.update({
      where: { id: roomId },
      data: { status: 'occupied' },
    });

    // Auto-generate invoice (async, non-blocking)
    this.generateBookingInvoice(booking).catch((err) => {
      this.logger.error(`Failed to auto-generate invoice for walk-in booking ${booking.id}: ${err.message}`);
    });

    // Log walk-in check-in action (async, non-blocking)
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_CHECKIN,
        resource: AuditResource.BOOKING,
        resourceId: booking.id,
        newValues: {
          status: 'checked_in',
          type: 'walk_in',
          guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
          roomNumber: booking.room?.number,
          actualCheckIn: booking.actualCheckIn,
        },
        oldValues: {},
        tenantId,
        description: `Walk-in guest ${booking.guestFirstName} ${booking.guestLastName} checked in to Room ${booking.room?.number || 'N/A'}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log walk-in check-in: ${err.message}`);
      });

    // Track analytics event (async, non-blocking)
    this.trackAnalytics(tenantId, 'walk_in_checkin', {
      bookingId: booking.id,
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomNumber: booking.room?.number,
      actualCheckInTime: booking.actualCheckIn,
      nights,
      totalPrice,
    }).catch((err) => {
      this.logger.error(`Failed to track walk_in_checkin event: ${err.message}`);
    });

    // Create check-in notification (async, non-blocking)
    this.notificationsService
      .create({
        title: 'Walk-in Guest Checked In',
        message: `${booking.guestFirstName} ${booking.guestLastName} (walk-in) checked in to Room ${booking.room?.number || 'N/A'}`,
        type: 'check_in',
        tenantId,
      })
      .catch((err) => {
        this.logger.error(`Failed to create walk-in check-in notification: ${err.message}`);
      });

    // Send check-in email (async, non-blocking)
    this.emailEventsService
      .onBookingCheckIn(booking)
      .catch((err) => {
        this.logger.error(`Failed to send walk-in check-in email: ${err.message}`);
      });

    this.logger.log(`Walk-in booking created and checked in: ${booking.id} for guest ${guestFirstName} ${guestLastName} in Room ${room.number}`);

    return this.mapBookingResponse(booking);
  }

  // ─── Early Check-In / Late Check-Out ─────────────────────────────────────

  /**
   * Guest or staff requests early check-in for a booking.
   * If property.earlyCheckInEnabled is true and `approve` flag is set (manager/admin),
   * the request is approved immediately and the fee is recorded.
   * Otherwise it's stored as a pending request for manager review.
   */
  async requestEarlyCheckIn(
    id: string,
    tenantId: string | undefined,
    approve = false,
  ): Promise<unknown> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.findOne(id, tenantId);

    if (booking.status === 'cancelled' || booking.status === 'checked_out') {
      throw new BadRequestException(
        `Cannot request early check-in for a booking in status '${booking.status}'`,
      );
    }

    if (booking.requestedEarlyCheckIn) {
      throw new BadRequestException('Early check-in has already been requested for this booking');
    }

    // Fetch property time settings to calculate fee
    const property = await this.prisma.property.findFirst({
      where: { id: booking.propertyId, tenantId, deletedAt: null },
      select: {
        earlyCheckInEnabled: true,
        earlyCheckInFeeType: true,
        earlyCheckInFeeAmount: true,
      },
    });

    if (!property) {
      throw new BadRequestException('Property not found');
    }

    if (!property.earlyCheckInEnabled) {
      throw new BadRequestException('Early check-in is not enabled for this property');
    }

    const feeAmount = property.earlyCheckInFeeAmount
      ? Number(property.earlyCheckInFeeAmount)
      : 0;

    const updateData: Record<string, unknown> = {
      requestedEarlyCheckIn: true,
    };

    if (approve) {
      updateData.approvedEarlyCheckIn = true;
      updateData.earlyCheckInFee = feeAmount;
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: updateData,
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(
      `Early check-in ${approve ? 'approved' : 'requested'} for booking ${id} | fee: ${feeAmount}`,
    );

    return this.mapBookingResponse(updated);
  }

  /**
   * Manager/admin approves a pending early check-in request.
   */
  async approveEarlyCheckIn(id: string, tenantId: string | undefined): Promise<unknown> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.findOne(id, tenantId);

    if (!booking.requestedEarlyCheckIn) {
      throw new BadRequestException('No early check-in request found for this booking');
    }
    if (booking.approvedEarlyCheckIn) {
      throw new BadRequestException('Early check-in has already been approved');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: booking.propertyId, tenantId, deletedAt: null },
      select: { earlyCheckInFeeAmount: true },
    });

    const feeAmount = property?.earlyCheckInFeeAmount
      ? Number(property.earlyCheckInFeeAmount)
      : 0;

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        approvedEarlyCheckIn: true,
        earlyCheckInFee: feeAmount,
      },
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(`Early check-in approved for booking ${id} | fee: ${feeAmount}`);

    return this.mapBookingResponse(updated);
  }

  /**
   * Guest or staff requests late check-out for a booking.
   * If `approve` flag is set (manager/admin), the request is approved immediately.
   */
  async requestLateCheckOut(
    id: string,
    tenantId: string | undefined,
    approve = false,
  ): Promise<unknown> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.findOne(id, tenantId);

    if (booking.status === 'cancelled' || booking.status === 'checked_out') {
      throw new BadRequestException(
        `Cannot request late check-out for a booking in status '${booking.status}'`,
      );
    }

    if (booking.requestedLateCheckOut) {
      throw new BadRequestException('Late check-out has already been requested for this booking');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: booking.propertyId, tenantId, deletedAt: null },
      select: {
        lateCheckOutEnabled: true,
        lateCheckOutFeeType: true,
        lateCheckOutFeeAmount: true,
      },
    });

    if (!property) {
      throw new BadRequestException('Property not found');
    }

    if (!property.lateCheckOutEnabled) {
      throw new BadRequestException('Late check-out is not enabled for this property');
    }

    const feeAmount = property.lateCheckOutFeeAmount
      ? Number(property.lateCheckOutFeeAmount)
      : 0;

    const updateData: Record<string, unknown> = {
      requestedLateCheckOut: true,
    };

    if (approve) {
      updateData.approvedLateCheckOut = true;
      updateData.lateCheckOutFee = feeAmount;
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: updateData,
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(
      `Late check-out ${approve ? 'approved' : 'requested'} for booking ${id} | fee: ${feeAmount}`,
    );

    return this.mapBookingResponse(updated);
  }

  /**
   * Manager/admin approves a pending late check-out request.
   */
  async approveLateCheckOut(id: string, tenantId: string | undefined): Promise<unknown> {
    if (!tenantId) throw new BadRequestException('Tenant ID is required');

    const booking = await this.findOne(id, tenantId);

    if (!booking.requestedLateCheckOut) {
      throw new BadRequestException('No late check-out request found for this booking');
    }
    if (booking.approvedLateCheckOut) {
      throw new BadRequestException('Late check-out has already been approved');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: booking.propertyId, tenantId, deletedAt: null },
      select: { lateCheckOutFeeAmount: true },
    });

    const feeAmount = property?.lateCheckOutFeeAmount
      ? Number(property.lateCheckOutFeeAmount)
      : 0;

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        approvedLateCheckOut: true,
        lateCheckOutFee: feeAmount,
      },
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(`Late check-out approved for booking ${id} | fee: ${feeAmount}`);

    return this.mapBookingResponse(updated);
  }
}
