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

function toBookingStatusLabel(status?: string): string {
  switch (status) {
    case 'pending':
      return 'รอยืนยัน';
    case 'confirmed':
      return 'ยืนยันแล้ว';
    case 'checked_in':
      return 'เช็คอินแล้ว';
    case 'checked_out':
      return 'เช็คเอาท์แล้ว';
    case 'cancelled':
      return 'ยกเลิก';
    default:
      return status ?? '-';
  }
}

type NightlyPricingRow = {
  date: string;
  dayName: string;
  baseRate: number;
  appliedRate: number;
  pricingType: 'base' | 'weekend' | 'holiday' | 'seasonal';
  pricingLabel: string;
  note?: string;
};

type BookingPricingSummary = {
  nightlyRates: NightlyPricingRow[];
  roomSubtotal: number;
  serviceChargePercent: number;
  serviceChargeAmount: number;
  vatPercent: number;
  vatAmount: number;
  grandTotal: number;
  currency: 'THB';
};

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
    // Treat the time as Bangkok local time (UTC+7) by appending the offset.
    // e.g. "2026-04-23" + "14:00" → "2026-04-23T14:00:00+07:00" = 07:00 UTC stored in DB,
    // which renders correctly as 14:00 when displayed in Bangkok timezone.
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    return new Date(`${value}T${hh}:${mm}:00+07:00`);
  }

  private asNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private toFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private toDateOnlyString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private formatDateLabel(value: Date | string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat('th-TH', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(date);
  }

  private getDateRange(checkInDate: Date, checkOutDate: Date): Date[] {
    const dates: Date[] = [];
    const cursor = new Date(Date.UTC(
      checkInDate.getUTCFullYear(),
      checkInDate.getUTCMonth(),
      checkInDate.getUTCDate(),
    ));
    const end = new Date(Date.UTC(
      checkOutDate.getUTCFullYear(),
      checkOutDate.getUTCMonth(),
      checkOutDate.getUTCDate(),
    ));

    while (cursor < end) {
      dates.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
  }

  private normalizeCreateBookingDto(createBookingDto: CreateBookingDto): CreateBookingDto {
    const rawDto = createBookingDto as any;

    // 1. Map guest info aliases (guestName, guest.name, etc.)
    const guestName =
      this.asNonEmptyString(rawDto.guestName) ??
      this.asNonEmptyString(rawDto.guest?.name) ??
      this.asNonEmptyString(rawDto.fullName);

    if (!createBookingDto.guestFirstName) {
      const fn = this.asNonEmptyString(rawDto.guest?.firstName) ?? this.asNonEmptyString(rawDto.guest?.first_name);
      if (fn) {
        createBookingDto.guestFirstName = fn;
      } else if (guestName) {
        createBookingDto.guestFirstName = guestName.split(/\s+/)[0];
      }
    }

    if (!createBookingDto.guestLastName) {
      const ln = this.asNonEmptyString(rawDto.guest?.lastName) ?? this.asNonEmptyString(rawDto.guest?.last_name);
      if (ln) {
        createBookingDto.guestLastName = ln;
      } else if (guestName) {
        const parts = guestName.split(/\s+/);
        createBookingDto.guestLastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      }
    }

    createBookingDto.guestEmail =
      createBookingDto.guestEmail ??
      this.asNonEmptyString(rawDto.guest?.email);

    createBookingDto.guestPhone =
      createBookingDto.guestPhone ??
      this.asNonEmptyString(rawDto.guest?.phone);

    // 2. Map date aliases (checkInDate, startDate, dateRange.from, etc.)
    createBookingDto.checkIn =
      createBookingDto.checkIn ??
      this.asNonEmptyString(rawDto.checkInDate) ??
      this.asNonEmptyString(rawDto.startDate) ??
      this.asNonEmptyString(rawDto.dateRange?.from);

    createBookingDto.checkOut =
      createBookingDto.checkOut ??
      this.asNonEmptyString(rawDto.checkOutDate) ??
      this.asNonEmptyString(rawDto.endDate) ??
      this.asNonEmptyString(rawDto.dateRange?.to);

    // 3. Map property alias (property.id)
    createBookingDto.propertyId =
      createBookingDto.propertyId ??
      this.asNonEmptyString(rawDto.property?.id);

    createBookingDto.adults =
      createBookingDto.adults ??
      this.toFiniteNumber(rawDto.guestCounts?.adults) ??
      this.toFiniteNumber(rawDto.occupancy?.adults);

    createBookingDto.children =
      createBookingDto.children ??
      this.toFiniteNumber(rawDto.guestCounts?.children) ??
      this.toFiniteNumber(rawDto.occupancy?.children);

    createBookingDto.numberOfGuests =
      createBookingDto.numberOfGuests ??
      this.toFiniteNumber(rawDto.guestCounts?.total) ??
      this.toFiniteNumber(rawDto.occupancy?.total);

    // 4. Initial validation (ensure core fields exist)
    if (!createBookingDto.checkIn) {
      throw new BadRequestException('checkIn is required');
    }

    if (!createBookingDto.checkOut) {
      throw new BadRequestException('checkOut is required');
    }

    // MANDATORY logic: guestFirstName/LastName can be skipped ONLY if guestId is present,
    // as we'll fetch them from the database in the next step.
    if (!createBookingDto.guestId) {
      if (!createBookingDto.guestFirstName) {
        throw new BadRequestException('guestFirstName is required');
      }
      if (!createBookingDto.guestLastName) {
        throw new BadRequestException('guestLastName is required');
      }
    }

    return createBookingDto;
  }

  private resolveOccupancy(createBookingDto: CreateBookingDto, room: any): {
    adults: number;
    children: number;
    numberOfGuests: number;
    baseCapacity: number;
    extraBedCapacity: number;
    totalCapacity: number;
    standardBedGuests: number;
    extraBedGuests: number;
  } {
    const adults = Math.max(0, Math.trunc(createBookingDto.adults ?? 1));
    const children = Math.max(0, Math.trunc(createBookingDto.children ?? 0));
    const fallbackGuestCount = adults + children > 0 ? adults + children : 1;
    const numberOfGuests = Math.max(
      1,
      Math.trunc(createBookingDto.numberOfGuests ?? fallbackGuestCount),
    );

    const baseCapacity = Math.max(0, Number(room.maxOccupancy ?? 0));
    const extraBedCapacity =
      room.extraBedAllowed ? Math.max(0, Number(room.extraBedLimit ?? 0)) : 0;
    const totalCapacity = baseCapacity + extraBedCapacity;
    const standardBedGuests = baseCapacity > 0
      ? Math.min(numberOfGuests, baseCapacity)
      : numberOfGuests;
    const extraBedGuests = Math.max(0, numberOfGuests - standardBedGuests);

    if (totalCapacity > 0 && numberOfGuests > totalCapacity) {
      throw new BadRequestException(
        `Room capacity exceeded: supports ${totalCapacity} guests`,
      );
    }

    return {
      adults,
      children,
      numberOfGuests,
      baseCapacity,
      extraBedCapacity,
      totalCapacity,
      standardBedGuests,
      extraBedGuests,
    };
  }

  private calculateNightlyRate(
    room: any,
    date: Date,
    holidayDates: Set<string>,
  ): NightlyPricingRow {
    const dateString = this.toDateOnlyString(date);
    const baseRate = Number(room.price ?? 0);
    let appliedRate = baseRate;
    let pricingType: NightlyPricingRow['pricingType'] = 'base';
    let pricingLabel = 'ราคาปกติ';
    let note: string | undefined;

    const seasonalRates = Array.isArray(room.seasonalRates) ? room.seasonalRates : [];
    const seasonalMatch = seasonalRates
      .filter((rate: any) => rate?.isActive !== false)
      .find((rate: any) => {
        const startDate = this.asNonEmptyString(rate?.startDate);
        const endDate = this.asNonEmptyString(rate?.endDate);
        return !!startDate && !!endDate && startDate <= dateString && dateString <= endDate;
      });

    if (seasonalMatch) {
      if (seasonalMatch.priceType === 'fixed' && this.toFiniteNumber(seasonalMatch.price) !== undefined) {
        appliedRate = this.toFiniteNumber(seasonalMatch.price) as number;
      } else if (
        seasonalMatch.priceType === 'percent' &&
        this.toFiniteNumber(seasonalMatch.percentAdjust) !== undefined
      ) {
        appliedRate = baseRate * (1 + (this.toFiniteNumber(seasonalMatch.percentAdjust) as number) / 100);
      }
      pricingType = 'seasonal';
      pricingLabel = seasonalMatch.name || 'Seasonal rate';
      note = this.asNonEmptyString(seasonalMatch.note);
    } else if (holidayDates.has(dateString) && room.holidayPriceEnabled) {
      if (room.holidayPriceType === 'fixed' && room.holidayPrice !== null && room.holidayPrice !== undefined) {
        appliedRate = Number(room.holidayPrice);
      } else if (
        room.holidayPriceType === 'percent' &&
        room.holidayPricePercent !== null &&
        room.holidayPricePercent !== undefined
      ) {
        appliedRate = baseRate * (1 + Number(room.holidayPricePercent) / 100);
      } else if (room.holidayPrice !== null && room.holidayPrice !== undefined) {
        appliedRate = Number(room.holidayPrice);
      }
      pricingType = 'holiday';
      pricingLabel = 'วันหยุด';
      note = 'Applied holiday pricing';
    } else {
      const utcDay = date.getUTCDay();
      const isWeekend = utcDay === 0 || utcDay === 6;
      if (isWeekend && room.weekendPrice !== null && room.weekendPrice !== undefined) {
        appliedRate = Number(room.weekendPrice);
        pricingType = 'weekend';
        pricingLabel = 'วันหยุดสุดสัปดาห์';
        note = 'Applied weekend pricing';
      }
    }

    return {
      date: dateString,
      dayName: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date),
      baseRate: this.roundCurrency(baseRate),
      appliedRate: this.roundCurrency(appliedRate),
      pricingType,
      pricingLabel,
      ...(note && { note }),
    };
  }

  private resolveBookingPricing(
    createBookingDto: CreateBookingDto,
    room: any,
    property: any,
    checkInDate: Date,
    checkOutDate: Date,
  ): BookingPricingSummary {
    const holidayDates = new Set(
      Array.isArray((createBookingDto as any).holidayDates)
        ? ((createBookingDto as any).holidayDates as unknown[])
            .map((value) => this.asNonEmptyString(value))
            .filter((value): value is string => !!value)
        : [],
    );

    const frontendBreakdown = (createBookingDto as any).pricingBreakdown;
    if (frontendBreakdown && typeof frontendBreakdown === 'object' && Array.isArray(frontendBreakdown.nightlyRates)) {
      return {
        nightlyRates: frontendBreakdown.nightlyRates.map((row: any) => ({
          date: String(row.date),
          dayName: String(row.dayName ?? ''),
          baseRate: this.roundCurrency(Number(row.baseRate ?? row.appliedRate ?? 0)),
          appliedRate: this.roundCurrency(Number(row.appliedRate ?? row.rate ?? 0)),
          pricingType: (row.pricingType ?? 'base') as NightlyPricingRow['pricingType'],
          pricingLabel: String(row.pricingLabel ?? row.label ?? 'Custom pricing'),
          ...(row.note ? { note: String(row.note) } : {}),
        })),
        roomSubtotal: this.roundCurrency(Number(frontendBreakdown.roomSubtotal ?? 0)),
        serviceChargePercent: this.roundCurrency(Number(frontendBreakdown.serviceChargePercent ?? property.serviceChargePercent ?? 0)),
        serviceChargeAmount: this.roundCurrency(Number(frontendBreakdown.serviceChargeAmount ?? 0)),
        vatPercent: this.roundCurrency(Number(frontendBreakdown.vatPercent ?? property.vatPercent ?? 0)),
        vatAmount: this.roundCurrency(Number(frontendBreakdown.vatAmount ?? 0)),
        grandTotal: this.roundCurrency(Number(frontendBreakdown.grandTotal ?? frontendBreakdown.totalAmount ?? 0)),
        currency: 'THB',
      };
    }

    const nightlyRates = this.getDateRange(checkInDate, checkOutDate).map((date) =>
      this.calculateNightlyRate(room, date, holidayDates),
    );

    const roomSubtotal = this.roundCurrency(
      nightlyRates.reduce((sum, nightlyRate) => sum + nightlyRate.appliedRate, 0),
    );

    const serviceChargePercent = property.serviceChargeEnabled
      ? Number(property.serviceChargePercent ?? 10)
      : 0;
    const serviceChargeAmount = this.roundCurrency(roomSubtotal * (serviceChargePercent / 100));

    const vatBase = roomSubtotal + serviceChargeAmount;
    const vatPercent = property.vatEnabled ? Number(property.vatPercent ?? 7) : 0;
    const vatAmount = this.roundCurrency(vatBase * (vatPercent / 100));

    return {
      nightlyRates,
      roomSubtotal,
      serviceChargePercent: this.roundCurrency(serviceChargePercent),
      serviceChargeAmount,
      vatPercent: this.roundCurrency(vatPercent),
      vatAmount,
      grandTotal: this.roundCurrency(roomSubtotal + serviceChargeAmount + vatAmount),
      currency: 'THB',
    };
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

    const roomSubtotal = Number(booking.roomSubtotal ?? booking.totalPrice ?? 0);
    const serviceChargeAmount = Number(booking.serviceChargeAmount ?? 0);
    const vatAmount = Number(booking.vatAmount ?? 0);
    const grandTotal = Number(
      booking.grandTotal ?? roomSubtotal + serviceChargeAmount + vatAmount,
    );
    const amountPaid = Number(booking.amountPaid ?? 0);
    const guestName = `${booking.guestFirstName ?? ''} ${booking.guestLastName ?? ''}`.trim();
    const roomNumber = booking.room?.number ?? null;
    const roomType = booking.room?.type ?? null;
    const propertyName = booking.property?.name ?? null;
    const propertyCode = booking.property?.code ?? null;
    const pricingBreakdown = booking.pricingBreakdown ?? null;
    const nightlyRates = Array.isArray(pricingBreakdown?.nightlyRates)
      ? pricingBreakdown.nightlyRates
      : [];
    const source = booking.source ?? null;
    const statusLabel = toBookingStatusLabel(booking.status);
    const checkInLabel = this.formatDateLabel(booking.checkIn);
    const checkOutLabel = this.formatDateLabel(booking.checkOut);
    const roomLabel = roomNumber
      ? `${roomNumber}${roomType ? ` · ${String(roomType).toUpperCase()}` : ''}`
      : null;
    const dateRangeLabel =
      checkInLabel && checkOutLabel ? `${checkInLabel} - ${checkOutLabel}` : null;
    const baseCapacity = Number(booking.baseCapacity ?? booking.room?.maxOccupancy ?? 0);
    const extraBedCapacity = Number(
      booking.extraBedCapacity ??
      (booking.room?.extraBedAllowed ? booking.room?.extraBedLimit ?? 0 : 0),
    );
    const totalCapacity = Number(booking.totalCapacity ?? baseCapacity + extraBedCapacity);
    const standardBedGuests = Number(
      booking.standardBedGuests ??
      Math.min(Number(booking.numberOfGuests ?? 1), baseCapacity || Number(booking.numberOfGuests ?? 1)),
    );
    const extraBedGuests = Number(
      booking.extraBedGuests ?? Math.max(0, Number(booking.numberOfGuests ?? 1) - standardBedGuests),
    );

    return {
      ...booking,
      // Alias fields — frontend uses checkInDate / checkOutDate
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      guestName,
      roomNumber,
      roomType,
      roomLabel,
      propertyName,
      propertyCode,
      source,
      statusLabel,
      checkInLabel,
      checkOutLabel,
      dateRangeLabel,
      adults: Number(booking.adults ?? 1),
      children: Number(booking.children ?? 0),
      numberOfGuests: Number(booking.numberOfGuests ?? booking.adults ?? 1),
      baseCapacity,
      extraBedCapacity,
      totalCapacity,
      standardBedGuests,
      extraBedGuests,
      capacitySummary: {
        baseCapacity,
        extraBedCapacity,
        totalCapacity,
        standardBedGuests,
        extraBedGuests,
        extraBedAllowed: extraBedCapacity > 0,
      },
      roomSubtotal,
      serviceChargeAmount,
      vatAmount,
      grandTotal,
      pricingBreakdown,
      nightlyRates,
      paymentSummary: {
        paymentMethod: booking.paymentMethod ?? null,
        paymentStatus: booking.paymentStatus ?? null,
        amountPaid,
        balanceRemaining: this.roundCurrency(Math.max(0, grandTotal - amountPaid)),
      },
      staySummary: {
        scheduledCheckIn: booking.scheduledCheckIn ?? null,
        scheduledCheckOut: booking.scheduledCheckOut ?? null,
        actualCheckIn: booking.actualCheckIn ?? null,
        actualCheckOut: booking.actualCheckOut ?? null,
        numberOfNights: nights,
      },
      // totalAmount — frontend field; use gross total when available
      totalAmount: grandTotal,
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

    createBookingDto = this.normalizeCreateBookingDto(createBookingDto);

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

    // FINAL VALIDATION: Ensure we have names before proceeding to creation
    if (!createBookingDto.guestFirstName) {
      throw new BadRequestException('guestFirstName is required');
    }
    if (!createBookingDto.guestLastName) {
      throw new BadRequestException('guestLastName is required');
    }

    const occupancy = this.resolveOccupancy(createBookingDto, room);
    const pricingSummary = this.resolveBookingPricing(
      createBookingDto,
      room,
      property,
      checkInDate,
      checkOutDate,
    );

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
      adults:         occupancy.adults,
      children:       occupancy.children,
      numberOfGuests: occupancy.numberOfGuests,
      baseCapacity:   occupancy.baseCapacity,
      extraBedCapacity: occupancy.extraBedCapacity,
      totalCapacity:  occupancy.totalCapacity,
      standardBedGuests: occupancy.standardBedGuests,
      extraBedGuests: occupancy.extraBedGuests,
      checkIn:        toDateTime(createBookingDto.checkIn),
      checkOut:       toDateTime(createBookingDto.checkOut),
      scheduledCheckIn: this.buildScheduledDateTime(
        createBookingDto.checkIn,
        createBookingDto.checkInTime ?? property.standardCheckInTime ?? '14:00',
      ),
      scheduledCheckOut: this.buildScheduledDateTime(
        createBookingDto.checkOut,
        createBookingDto.checkOutTime ?? property.standardCheckOutTime ?? '11:00',
      ),
      status:         createBookingDto.status || 'pending',
      notes:          createBookingDto.notes || undefined,
      channelId:      createBookingDto.channelId || undefined,
      paymentMethod:  rawPaymentMethod || undefined,
      paymentStatus:  rawPaymentMethod ? 'pending' : undefined,
      totalPrice:     pricingSummary.roomSubtotal,
      roomSubtotal:   pricingSummary.roomSubtotal,
      serviceChargeAmount: pricingSummary.serviceChargeAmount,
      vatAmount:      pricingSummary.vatAmount,
      grandTotal:     pricingSummary.grandTotal,
      pricingBreakdown: pricingSummary as unknown as Prisma.InputJsonValue,
      source:         createBookingDto.source || 'DIRECT',
      tenantId,
    };

    const booking: any = await this.prisma.booking.create({
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
      grandTotal: booking.grandTotal ?? pricingSummary.grandTotal,
      adults: booking.adults ?? occupancy.adults,
      children: booking.children ?? occupancy.children,
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

    // Stage 6: Auto-create housekeeping task with roomReadyAt = actualCheckOut + cleaningBufferMinutes
    if (booking.roomId) {
      const cleaningBufferMinutes = updated.property?.cleaningBufferMinutes ?? 60;
      const roomReadyAt = new Date(now.getTime() + cleaningBufferMinutes * 60 * 1000);

      this.housekeepingService
        .createTask(
          {
            roomId: booking.roomId,
            type: TaskType.CHECKOUT,
            priority: TaskPriority.HIGH,
            notes: `Checkout cleaning - Guest: ${booking.guestFirstName} ${booking.guestLastName}, Room: ${booking.room?.number || 'N/A'}`,
            estimatedDuration: cleaningBufferMinutes,
            bookingId: booking.id,
            scheduledFor: now.toISOString(),
            roomReadyAt: roomReadyAt.toISOString(),
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
    const roomCharge = Number(booking.roomSubtotal ?? booking.totalPrice);
    const serviceChargeAmount = Number(booking.serviceChargeAmount ?? 0);
    const vatAmount = Number(booking.vatAmount ?? 0);
    const baseBookingTotal = Number(
      booking.grandTotal ?? roomCharge + serviceChargeAmount + vatAmount,
    );

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
    const taxes = vatAmount;
    const totalAmount = baseBookingTotal + additionalCharges;

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
        serviceChargeAmount,
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
        amount: Number(booking.grandTotal ?? booking.totalPrice),
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
                notes: `Collect payment on check-in for booking ${booking.id.slice(0, 8)}. Guest: ${booking.guestFirstName} ${booking.guestLastName}. Amount: THB ${Number(booking.grandTotal ?? booking.totalPrice).toLocaleString()}.`,
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

      const roomCharge = booking?.grandTotal
        ? Number(booking.grandTotal)
        : booking?.totalPrice
          ? Number(booking.totalPrice)
          : Number(invoice.amount);
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

    const pricingSummary = this.resolveBookingPricing(
      {
        propertyId: finalPropertyId,
        roomId,
        guestFirstName,
        guestLastName,
        checkIn: now.toISOString(),
        checkOut: checkOutDate.toISOString(),
        adults: 1,
        children: 0,
        numberOfGuests: 1,
      } as CreateBookingDto,
      room,
      property,
      now,
      checkOutDate,
    );

    // Create booking with checked-in status immediately
    const walkInBookingData: any = {
        guestFirstName,
        guestLastName,
        guestEmail: guestEmail || null,
        guestPhone: guestPhone || null,
        guestId: guest.id,
        roomId,
        propertyId: finalPropertyId,
        adults: 1,
        children: 0,
        numberOfGuests: 1,
        baseCapacity: Number(room.maxOccupancy ?? 0),
        extraBedCapacity: room.extraBedAllowed ? Number(room.extraBedLimit ?? 0) : 0,
        totalCapacity: Number(room.maxOccupancy ?? 0) + (room.extraBedAllowed ? Number(room.extraBedLimit ?? 0) : 0),
        standardBedGuests: 1,
        extraBedGuests: 0,
        checkIn: now,
        checkOut: checkOutDate,
        actualCheckIn: now,
        status: 'checked_in',
        totalPrice: pricingSummary.roomSubtotal,
        roomSubtotal: pricingSummary.roomSubtotal,
        serviceChargeAmount: pricingSummary.serviceChargeAmount,
        vatAmount: pricingSummary.vatAmount,
        grandTotal: pricingSummary.grandTotal,
        pricingBreakdown: pricingSummary as unknown as Prisma.InputJsonValue,
        source: 'WALK_IN',
        notes: notes || null,
        tenantId,
      };

    const booking: any = await this.prisma.booking.create({
      data: walkInBookingData,
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
      totalPrice: booking.grandTotal ?? pricingSummary.grandTotal,
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
