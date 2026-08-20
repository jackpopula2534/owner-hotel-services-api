import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import {
  TaskType,
  TaskPriority,
  TaskStatus,
} from '../housekeeping/dto/create-housekeeping-task.dto';
import { PaymentsService } from '../../payments/payments.service';
import { PaymentMethod, PaymentStatus } from '../../payments/entities/payment.entity';
import { Prisma } from '@prisma/client';
import {
  applyCleaningBuffer,
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  resolveTimeWithFallback,
} from '../../common/availability/availability.util';
import { CRM_EVENTS } from '../crm/crm.events';
import { applyLedgerBalances } from '../accounting/ledger/ledger-balance.util';
import {
  RevenuePostingService,
  hasPostableRevenue,
} from '../revenue/revenue-posting.service';
import { buildBookingRevenueInput } from '../revenue/sources/booking-revenue.source';
import { businessDateOf, toBangkokDate, DAY_MS } from '../../common/utils/bangkok-day.util';

// ─── Activity Types ───────────────────────────────────────────────────────────

export interface ActivityPerformer {
  id: string;
  name: string;
  role: string;
}

export interface BookingActivityItem {
  id: string;
  action: string;
  actionLabel: string;
  description: string;
  performedBy: ActivityPerformer;
  timestamp: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  category: string;
  icon: string;
  color: string;
}

// ─────────────────────────────────────────────────────────────────────────────

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
    private eventEmitter: EventEmitter2,
    private emailEventsService: EmailEventsService,
    private auditLogService: AuditLogService,
    private invoicesService: InvoicesService,
    private housekeepingService: HousekeepingService,
    private loyaltyService: LoyaltyService,
    private notificationsService: NotificationsService,
    private paymentsService: PaymentsService,
    private revenuePosting: RevenuePostingService,
  ) {}

  private parseBookingDate(value: string, fieldName: 'checkIn' | 'checkOut'): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO 8601 date`);
    }
    return parsed;
  }

  /**
   * Thin wrapper around the shared availability util so existing callers
   * inside this service keep working. New code should call
   * `buildBangkokDateTime` directly.
   */
  private buildScheduledDateTime(value: string, fallbackTime: string): Date {
    return buildBangkokDateTime(value, fallbackTime);
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
    const cursor = new Date(
      Date.UTC(checkInDate.getUTCFullYear(), checkInDate.getUTCMonth(), checkInDate.getUTCDate()),
    );
    const end = new Date(
      Date.UTC(
        checkOutDate.getUTCFullYear(),
        checkOutDate.getUTCMonth(),
        checkOutDate.getUTCDate(),
      ),
    );

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
      const fn =
        this.asNonEmptyString(rawDto.guest?.firstName) ??
        this.asNonEmptyString(rawDto.guest?.first_name);
      if (fn) {
        createBookingDto.guestFirstName = fn;
      } else if (guestName) {
        createBookingDto.guestFirstName = guestName.split(/\s+/)[0];
      }
    }

    if (!createBookingDto.guestLastName) {
      const ln =
        this.asNonEmptyString(rawDto.guest?.lastName) ??
        this.asNonEmptyString(rawDto.guest?.last_name);
      if (ln) {
        createBookingDto.guestLastName = ln;
      } else if (guestName) {
        const parts = guestName.split(/\s+/);
        createBookingDto.guestLastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
      }
    }

    createBookingDto.guestEmail =
      createBookingDto.guestEmail ?? this.asNonEmptyString(rawDto.guest?.email);

    createBookingDto.guestPhone =
      createBookingDto.guestPhone ?? this.asNonEmptyString(rawDto.guest?.phone);

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
      createBookingDto.propertyId ?? this.asNonEmptyString(rawDto.property?.id);

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

  private resolveOccupancy(
    createBookingDto: CreateBookingDto,
    room: any,
  ): {
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
    const extraBedCapacity = room.extraBedAllowed
      ? Math.max(0, Number(room.extraBedLimit ?? 0))
      : 0;
    const totalCapacity = baseCapacity + extraBedCapacity;

    // "Chargeable occupancy" logic:
    // If children stay free, they do not count towards the occupancy calculation
    // that triggers extra bed needs or capacity limits.
    const countableGuests = room.childNoExtraCharge ? adults : adults + children;

    const standardBedGuests =
      baseCapacity > 0 ? Math.min(countableGuests, baseCapacity) : countableGuests;

    const extraBedGuests = Math.max(0, countableGuests - standardBedGuests);

    if (totalCapacity > 0 && countableGuests > totalCapacity) {
      const guestLabel = room.childNoExtraCharge ? 'adults' : 'guests';
      throw new BadRequestException(
        `Room capacity exceeded: supports max ${totalCapacity} ${guestLabel}`,
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
      if (
        seasonalMatch.priceType === 'fixed' &&
        this.toFiniteNumber(seasonalMatch.price) !== undefined
      ) {
        appliedRate = this.toFiniteNumber(seasonalMatch.price) as number;
      } else if (
        seasonalMatch.priceType === 'percent' &&
        this.toFiniteNumber(seasonalMatch.percentAdjust) !== undefined
      ) {
        appliedRate =
          baseRate * (1 + (this.toFiniteNumber(seasonalMatch.percentAdjust) as number) / 100);
      }
      pricingType = 'seasonal';
      pricingLabel = seasonalMatch.name || 'Seasonal rate';
      note = this.asNonEmptyString(seasonalMatch.note);
    } else if (holidayDates.has(dateString) && room.holidayPriceEnabled) {
      if (
        room.holidayPriceType === 'fixed' &&
        room.holidayPrice !== null &&
        room.holidayPrice !== undefined
      ) {
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
    if (
      frontendBreakdown &&
      typeof frontendBreakdown === 'object' &&
      Array.isArray(frontendBreakdown.nightlyRates)
    ) {
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
        serviceChargePercent: this.roundCurrency(
          Number(frontendBreakdown.serviceChargePercent ?? property.serviceChargePercent ?? 0),
        ),
        serviceChargeAmount: this.roundCurrency(Number(frontendBreakdown.serviceChargeAmount ?? 0)),
        vatPercent: this.roundCurrency(
          Number(frontendBreakdown.vatPercent ?? property.vatPercent ?? 0),
        ),
        vatAmount: this.roundCurrency(Number(frontendBreakdown.vatAmount ?? 0)),
        grandTotal: this.roundCurrency(
          Number(frontendBreakdown.grandTotal ?? frontendBreakdown.totalAmount ?? 0),
        ),
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
    const grandTotal = Number(booking.grandTotal ?? roomSubtotal + serviceChargeAmount + vatAmount);
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
        (booking.room?.extraBedAllowed ? (booking.room?.extraBedLimit ?? 0) : 0),
    );
    const totalCapacity = Number(booking.totalCapacity ?? baseCapacity + extraBedCapacity);
    const standardBedGuests = Number(
      booking.standardBedGuests ??
        Math.min(
          Number(booking.numberOfGuests ?? 1),
          baseCapacity || Number(booking.numberOfGuests ?? 1),
        ),
    );
    const extraBedGuests = Number(
      booking.extraBedGuests ??
        Math.max(0, Number(booking.numberOfGuests ?? 1) - standardBedGuests),
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

    // Build scheduled check-in/out datetimes using the shared util.
    // - resolveTimeWithFallback handles: user time → property time → default ('14:00'/'12:00')
    // - buildBangkokDateTime appends the +07:00 offset for date-only strings
    const effectiveCheckInTime = resolveTimeWithFallback(
      createBookingDto.checkInTime,
      property.standardCheckInTime,
      DEFAULT_CHECK_IN_TIME,
    );
    const effectiveCheckOutTime = resolveTimeWithFallback(
      createBookingDto.checkOutTime,
      property.standardCheckOutTime,
      DEFAULT_CHECK_OUT_TIME,
    );
    const scheduledCheckInForOverlap = buildBangkokDateTime(checkIn, effectiveCheckInTime);
    const scheduledCheckOutForOverlap = buildBangkokDateTime(checkOut, effectiveCheckOutTime);

    // Apply symmetric cleaning buffer so back-to-back bookings respect
    // the property's cleaningBufferMinutes setting.
    const cleaningBufferMinutes = property.cleaningBufferMinutes ?? DEFAULT_CLEANING_BUFFER_MINUTES;
    const { overlapStart, overlapEnd } = applyCleaningBuffer(
      scheduledCheckInForOverlap,
      scheduledCheckOutForOverlap,
      cleaningBufferMinutes,
    );

    this.logger.debug(
      `Overlap check: scheduledCheckIn=${scheduledCheckInForOverlap.toISOString()}, scheduledCheckOut=${scheduledCheckOutForOverlap.toISOString()}, buffer=${cleaningBufferMinutes}min`,
    );

    // Check room availability — include pending so double-booking is blocked immediately
    // overlap condition (with buffer):
    //   existing.scheduledCheckIn < (newCheckOut + buffer) AND
    //   existing.scheduledCheckOut > (newCheckIn - buffer)
    const [existingBooking, existingBookingFallback] = await Promise.all([
      // Primary check: ใช้ scheduledCheckIn/Out ซึ่งเก็บ time ถูกต้อง
      this.prisma.booking.findFirst({
        where: {
          roomId,
          tenantId,
          status: { in: ['pending', 'confirmed', 'checked_in'] },
          scheduledCheckIn: { lt: overlapEnd },
          scheduledCheckOut: { gt: overlapStart },
        },
      }),
      // Fallback: สำหรับ booking เก่าที่ไม่มี scheduledCheckIn
      this.prisma.booking.findFirst({
        where: {
          roomId,
          tenantId,
          status: { in: ['pending', 'confirmed', 'checked_in'] },
          scheduledCheckIn: null,
          checkIn: { lt: overlapEnd },
          checkOut: { gt: overlapStart },
        },
      }),
    ]);

    if (existingBooking || existingBookingFallback) {
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
      propertyId: createBookingDto.propertyId,
      roomId: createBookingDto.roomId,
      guestId: createBookingDto.guestId || undefined,
      guestFirstName: createBookingDto.guestFirstName,
      guestLastName: createBookingDto.guestLastName,
      guestEmail: createBookingDto.guestEmail || undefined,
      guestPhone: createBookingDto.guestPhone || undefined,
      adults: occupancy.adults,
      children: occupancy.children,
      numberOfGuests: occupancy.numberOfGuests,
      baseCapacity: occupancy.baseCapacity,
      extraBedCapacity: occupancy.extraBedCapacity,
      totalCapacity: occupancy.totalCapacity,
      standardBedGuests: occupancy.standardBedGuests,
      extraBedGuests: occupancy.extraBedGuests,
      checkIn: toDateTime(createBookingDto.checkIn),
      checkOut: toDateTime(createBookingDto.checkOut),
      // Persistence uses the SAME resolved times as the overlap check above
      // — this guarantees the booking we just validated is stored with
      // exactly the dates we checked. No more 11:00 vs 12:00 drift.
      scheduledCheckIn: scheduledCheckInForOverlap,
      scheduledCheckOut: scheduledCheckOutForOverlap,
      status: createBookingDto.status || 'pending',
      notes: createBookingDto.notes || undefined,
      channelId: createBookingDto.channelId || undefined,
      paymentMethod: rawPaymentMethod || undefined,
      paymentStatus: rawPaymentMethod ? 'pending' : undefined,
      totalPrice: pricingSummary.roomSubtotal,
      roomSubtotal: pricingSummary.roomSubtotal,
      serviceChargeAmount: pricingSummary.serviceChargeAmount,
      vatAmount: pricingSummary.vatAmount,
      grandTotal: pricingSummary.grandTotal,
      pricingBreakdown: pricingSummary as unknown as Prisma.InputJsonValue,
      source: createBookingDto.source || 'DIRECT',
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
      .logBookingCreate(
        booking,
        (createBookingDto as any)._performedByUserId || 'system',
        undefined,
      )
      .catch((err) => {
        this.logger.error(`Failed to log booking creation: ${err.message}`);
      });

    // Auto-generate invoice + payment record (async, non-blocking)
    this.generateBookingInvoice(booking, rawPaymentMethod).catch((err) => {
      this.logger.error(
        `Failed to auto-generate invoice for booking ${booking.id}: ${err.message}`,
      );
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

    if (tenantId && booking.guestId) {
      this.eventEmitter.emit(CRM_EVENTS.BOOKING_CREATED, {
        bookingId: booking.id,
        tenantId,
        guestId: booking.guestId,
        totalAmount: Number(booking.grandTotal ?? booking.totalPrice ?? 0),
      });
    }

    return this.mapBookingResponse(booking);
  }

  async update(id: string, updateBookingDto: any, tenantId?: string, userId?: string) {
    const oldBooking = await this.findOne(id, tenantId);

    const updated = await this.prisma.booking.update({
      where: { id },
      data: updateBookingDto,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    // Detect if this is a status confirm or general update
    const oldStatus = oldBooking.status;
    const newStatus = updated.status;
    const isConfirm = oldStatus === 'pending' && newStatus === 'confirmed';
    const isNoteUpdate =
      updateBookingDto.notes !== undefined && Object.keys(updateBookingDto).length === 1;

    let auditAction = AuditAction.BOOKING_UPDATE;
    let auditDescription = `Booking updated for ${updated.guestFirstName} ${updated.guestLastName}`;

    if (isConfirm) {
      auditAction = AuditAction.BOOKING_CONFIRM;
      auditDescription = `Booking confirmed for ${updated.guestFirstName} ${updated.guestLastName}`;
    } else if (isNoteUpdate) {
      auditAction = AuditAction.BOOKING_NOTE_UPDATE;
      auditDescription = `Booking notes updated for ${updated.guestFirstName} ${updated.guestLastName}`;
    }

    this.auditLogService
      .log({
        action: auditAction,
        resource: AuditResource.BOOKING,
        resourceId: id,
        oldValues: {
          status: oldStatus,
          notes: oldBooking.notes,
          checkIn: oldBooking.checkIn,
          checkOut: oldBooking.checkOut,
        },
        newValues: {
          status: newStatus,
          notes: updated.notes,
          checkIn: updated.checkIn,
          checkOut: updated.checkOut,
        },
        userId: userId || 'system',
        tenantId,
        description: auditDescription,
      })
      .catch((err) => {
        this.logger.error(`Failed to log booking update: ${err.message}`);
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
    const daysEarly = Math.floor(
      (checkInDate.getTime() - actualCheckIn.getTime()) / (1000 * 60 * 60 * 24),
    );
    const daysLate = Math.floor(
      (actualCheckIn.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24),
    );

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
    this.emailEventsService.onBookingCheckIn(updated).catch((err) => {
      this.logger.error(`Failed to send check-in confirmation email: ${err.message}`);
    });

    if (tenantId && booking.guestId) {
      this.eventEmitter.emit(CRM_EVENTS.BOOKING_CHECKED_IN, {
        bookingId: booking.id,
        tenantId,
        guestId: booking.guestId,
        totalAmount: Number(updated.grandTotal ?? updated.totalPrice ?? booking.totalPrice ?? 0),
      });
    }

    return this.mapBookingResponse(updated);
  }

  async checkOut(id: string, tenantId?: string): Promise<any> {
    const booking = await this.findOne(id, tenantId);

    if (booking.status !== 'checked_in') {
      throw new BadRequestException('Booking must be checked in before check out');
    }

    const now = new Date();

    // รายการเพิ่มเติมบนใบแจ้งหนี้ (พนักงานคีย์เข้าบิลห้องเอง) — อ่านก่อนเปิดทรานแซกชัน
    // เพราะ `finalizeCheckoutInvoice` ที่รวมยอดเดียวกันนี้วิ่งแบบไม่บล็อกทีหลัง
    // ถ้ารอมันสมุดรายได้จะได้ยอดคนละก้อนกับใบแจ้งหนี้แล้วแต่ใครเสร็จก่อน
    const additionalCharges = await this.sumInvoiceExtras(id, tenantId);

    // เช็คเอาต์กับลงสมุดรายได้อยู่ในทรานแซกชันเดียวกัน — ห้องที่ปิดบิลแล้วแต่รายได้
    // ไม่ถูกบันทึกคือยอดที่หายไปจากทุกรายงานโดยไม่มีอะไรฟ้อง
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.update({
        where: { id },
        data: {
          status: 'checked_out',
          actualCheckOut: now,
        },
        include: { guest: true, room: true, property: true },
      });

      const revenue = buildBookingRevenueInput(row, additionalCharges);
      if (hasPostableRevenue(revenue)) {
        await this.revenuePosting.postWithin(tx, revenue);
      }

      return row;
    });

    // Update room status to dirty (ว่างยังไม่สะอาด)
    // dirty = checkout เสร็จแล้ว รอมอบหมายแม่บ้าน
    // cleaning = แม่บ้านรับงานและเริ่มทำแล้ว (housekeeping service จัดการ)
    if (booking.roomId) {
      await this.prisma.room
        .update({
          where: { id: booking.roomId },
          data: { status: 'dirty' },
        })
        .catch(() => {});
    }

    // Finalize invoice (calculate actual stay duration)
    const stayDuration = Math.ceil(
      (now.getTime() - new Date(booking.actualCheckIn || booking.checkIn).getTime()) /
        (1000 * 60 * 60 * 24),
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
    this.emailEventsService.onBookingCheckout(updated).catch((err) => {
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
    this.emailEventsService.sendReviewRequest(updated).catch((err) => {
      this.logger.error(`Failed to send review request email: ${err.message}`);
    });

    if (tenantId && booking.guestId) {
      this.eventEmitter.emit(CRM_EVENTS.BOOKING_CHECKED_OUT, {
        bookingId: booking.id,
        tenantId,
        guestId: booking.guestId,
        totalAmount: Number(updated.grandTotal ?? updated.totalPrice ?? booking.totalPrice ?? 0),
      });
    }

    return this.mapBookingResponse(updated);
  }

  /**
   * ย้อนสถานะเช็คเอาต์ (กดผิดใบ / ผิดห้อง / แขกยังไม่ไป)
   *
   * เช็คเอาต์เป็นประตูทางเดียวของทั้งระบบ — มันปิดบิล ลงสมุดรายได้ ตั้งห้องเป็นสกปรก
   * สั่งงานแม่บ้าน แจกแต้ม แล้วปล่อยคืนที่เหลือกลับเข้าคลังให้ขายใหม่ พนักงานที่กด
   * ผิดใบจึงไม่มีทางแก้เองเลยนอกจากไปแก้สถานะดิบ ๆ ในฐานข้อมูล ซึ่งทิ้งรายได้
   * ค้างสมุดไว้ทั้งก้อน เมธอดนี้คือทางกลับที่ถอนของพวกนั้นให้ครบในคราวเดียว
   *
   * ขอบเขตที่ยอมให้ย้อนได้ จงใจแคบ:
   * 1. ต้องเป็นวันทำการ (เวลาไทย) เดียวกับที่เช็คเอาต์ — ข้ามวันแล้ว `voidWithin`
   *    จะเขียนแถวกลับรายการลงวันปัจจุบันแทนการล้างแถวเดิม แล้ว `postWithin` จะไม่
   *    ยอมลงรายได้ใบนี้อีกตลอดไป (เช็คอินกลับได้แต่เช็คเอาต์รอบสองจะพัง)
   *    ข้ามวันแล้วต้องใช้เส้นทางบัญชี: ยกเลิก/คืนเงิน แล้วเปิดใบใหม่
   * 2. ห้องต้องยังไม่ถูกขายต่อ — คืนที่ปล่อยคืนคลังไปแล้วอาจมีคนจองทับ
   *
   * งานแม่บ้านที่แม่บ้าน "ยังไม่แตะ" จะถูกลบทิ้ง ใบที่รับงาน/ทำไปแล้วเก็บไว้ตามจริง
   * แล้วรายงานกลับเป็นคำเตือน — ประวัติงานที่ทำจริงห้ามหายไปเพราะออฟฟิศกดผิด
   */
  async undoCheckOut(
    id: string,
    tenantId?: string,
    userId?: string,
    reason?: string,
  ): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const booking = await this.findOne(id, tenantId);

    if (booking.status !== 'checked_out') {
      throw new BadRequestException(
        `ย้อนสถานะได้เฉพาะการจองที่เช็คเอาต์แล้วเท่านั้น (สถานะปัจจุบัน: ${booking.status})`,
      );
    }

    const actualCheckOut = booking.actualCheckOut ? new Date(booking.actualCheckOut) : null;
    if (!actualCheckOut || Number.isNaN(actualCheckOut.getTime())) {
      throw new BadRequestException(
        'การจองนี้ไม่มีเวลาเช็คเอาต์จริงบันทึกไว้ จึงย้อนสถานะอัตโนมัติไม่ได้',
      );
    }

    const now = new Date();
    const checkOutDay = toBangkokDate(actualCheckOut);
    const today = toBangkokDate(now);
    if (checkOutDay !== today) {
      throw new BadRequestException(
        `ย้อนสถานะได้เฉพาะภายในวันเดียวกับที่เช็คเอาต์ (เช็คเอาต์เมื่อ ${checkOutDay}) ` +
          'ข้ามวันแล้วต้องแก้ผ่านการยกเลิก/คืนเงินและเปิดการจองใหม่ เพื่อไม่ให้ยอดของวันที่ปิดไปแล้วเปลี่ยน',
      );
    }

    // ห้องอาจถูกขายต่อทันทีที่เช็คเอาต์ — คืนที่เหลือกลับเข้าคลังไปแล้ว
    if (booking.roomId) {
      const conflict = await this.prisma.booking.findFirst({
        where: {
          tenantId,
          roomId: booking.roomId,
          id: { not: id },
          status: { in: ['pending', 'confirmed', 'checked_in'] },
          checkIn: { lt: new Date(booking.checkOut) },
          checkOut: { gt: now },
        },
        select: { id: true, bookingNo: true },
      });
      if (conflict) {
        throw new ConflictException(
          `ห้องนี้ถูกจองต่อแล้ว (${conflict.bookingNo ?? conflict.id.slice(0, 8)}) ` +
            'ย้อนสถานะไม่ได้ ต้องย้ายการจองที่ทับก่อน',
        );
      }
    }

    // งานแม่บ้านที่ยังไม่มีใครรับ ลบได้ ใบที่เริ่มทำแล้วเก็บไว้เป็นประวัติ
    const checkoutTasks = await this.prisma.housekeepingTask.findMany({
      where: { tenantId, bookingId: id, type: TaskType.CHECKOUT },
      select: { id: true, status: true, assignedToId: true },
    });
    const untouchedTaskIds = checkoutTasks
      .filter((t) => t.status === TaskStatus.PENDING && !t.assignedToId)
      .map((t) => t.id);
    const keptTasks = checkoutTasks.filter((t) => !untouchedTaskIds.includes(t.id));

    const { updated, revenue } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.update({
        where: { id },
        data: { status: 'checked_in', actualCheckOut: null },
        include: { guest: true, room: true, property: true },
      });

      // วันเดียวกัน = ล้างแถวเดิมเป็น VOIDED (ไม่ใช่แถวกลับรายการ) เช็คเอาต์รอบใหม่
      // จึงลงรายได้ทับได้ตามปกติ — นี่คือเหตุผลเดียวที่กติกา "ภายในวันเดียวกัน" มีอยู่
      const voided = await this.revenuePosting.voidWithin(tx, {
        tenantId,
        sourceType: 'BOOKING',
        sourceId: id,
        voidedBy: userId || 'system',
        reason: reason ? `ย้อนสถานะเช็คเอาต์: ${reason}` : 'ย้อนสถานะเช็คเอาต์',
        at: now,
      });

      if (untouchedTaskIds.length > 0) {
        await tx.housekeepingTask.deleteMany({
          where: { tenantId, id: { in: untouchedTaskIds } },
        });
      }

      if (booking.roomId) {
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'occupied' },
        });
      }

      return { updated: row, revenue: voided };
    });

    const warnings: string[] = [];
    if (keptTasks.length > 0) {
      warnings.push(
        `งานแม่บ้าน ${keptTasks.length} ใบเริ่มทำไปแล้ว จึงไม่ถูกยกเลิกให้ กรุณาแจ้งแม่บ้านเอง`,
      );
    }
    if (revenue.reversed > 0) {
      warnings.push('รายได้บางส่วนถูกกลับรายการข้ามวัน ตรวจสอบรายงานรายได้ก่อนเช็คเอาต์ใหม่');
    }

    // กลับรายการบัญชี (async, ไม่บล็อก) — ระบบโรงแรมต้องกลับสถานะได้แม้บัญชีล้ม
    this.reverseBookingRevenueJournal(id, tenantId, userId || 'system').catch((err: Error) => {
      this.logger.warn(`Journal reversal skipped for booking ${id}: ${err.message}`);
    });

    // แต้มที่แจกตอนเช็คเอาต์ต้องดึงคืน ไม่งั้นกดผิดหนึ่งครั้ง = แต้มฟรีหนึ่งชุด
    if (booking.guestId) {
      this.loyaltyService
        .reverseStayAward(tenantId, booking.guestId, id)
        .catch((err: Error) => {
          this.logger.warn(`Loyalty clawback skipped for booking ${id}: ${err.message}`);
        });
    }

    this.auditLogService
      .log({
        action: AuditAction.BOOKING_CHECKOUT_UNDO,
        resource: AuditResource.BOOKING,
        resourceId: id,
        oldValues: { status: 'checked_out', actualCheckOut: actualCheckOut.toISOString() },
        newValues: { status: 'checked_in', actualCheckOut: null },
        userId: userId || 'system',
        tenantId,
        description:
          `ย้อนสถานะเช็คเอาต์ของ ${booking.guestFirstName} ${booking.guestLastName} ` +
          `(ห้อง ${booking.room?.number || 'N/A'})` +
          (reason ? ` — เหตุผล: ${reason}` : ''),
      })
      .catch((err) => {
        this.logger.error(`Failed to log checkout undo: ${err.message}`);
      });

    this.logger.log(
      `Checkout undone for booking ${booking.bookingNo ?? id} by ${userId || 'system'}: ` +
        `revenue voided=${revenue.voided} reversed=${revenue.reversed}, ` +
        `housekeeping removed=${untouchedTaskIds.length} kept=${keptTasks.length}`,
    );

    return {
      ...this.mapBookingResponse(updated),
      undo: {
        revenue,
        housekeepingTasksRemoved: untouchedTaskIds.length,
        housekeepingTasksKept: keptTasks.length,
        warnings,
      },
    };
  }

  /**
   * ยอดรวมรายการเพิ่มเติมบนใบแจ้งหนี้ของการจองนี้
   *
   * เป็นค่าบริการที่พนักงานคีย์เข้าบิลห้องเอง (มินิบาร์ รถรับส่ง ค่าปรับ) — **ไม่ใช่**
   * บิล POS ที่ชาร์จเข้าห้อง บิลพวกนั้นลงสมุดรายได้เป็นแถวของร้านตัวเองไปแล้วตอนปิดบิล
   * ถ้านับซ้ำตรงนี้ ยอดรวมของโรงแรมจะบวมขึ้นเท่ากับยอด POS ทั้งหมดของทริปนั้น
   *
   * ไม่มีใบแจ้งหนี้ = 0 ไม่ใช่ error — การจองที่จ่ายครบตั้งแต่จองยังเช็คเอาต์ได้ปกติ
   */
  private async sumInvoiceExtras(bookingId: string, tenantId?: string): Promise<number> {
    const invoice = await this.prisma.invoices.findFirst({
      where: { booking_id: bookingId, tenant_id: tenantId },
      select: { invoice_items: { select: { amount: true } } },
    });
    return (
      invoice?.invoice_items?.reduce((sum, item) => sum + Number(item.amount || 0), 0) ?? 0
    );
  }

  async getCheckoutSummary(id: string, tenantId?: string): Promise<any> {
    const booking = await this.findOne(id, tenantId);

    // Calculate stay duration
    const checkInDate = new Date(booking.actualCheckIn || booking.checkIn);
    const checkOutDate = booking.actualCheckOut ? new Date(booking.actualCheckOut) : new Date();
    const stayDuration = Math.ceil(
      (checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24),
    );

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
    const additionalCharges =
      invoice?.invoice_items?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0;

    // Calculate subtotal and taxes
    const subtotal = roomCharge + additionalCharges;
    const taxes = vatAmount;
    const totalAmount = baseBookingTotal + additionalCharges;

    // Calculate amount paid from approved payments
    const amountPaid =
      invoice?.payments
        ?.filter((p: any) => p.status === 'approved')
        ?.reduce((sum, p: any) => sum + Number(p.amount || 0), 0) || 0;

    const balanceRemaining = totalAmount - amountPaid;

    // ── ออกก่อนกำหนด ─────────────────────────────────────────────────────
    // เช็คเอาต์ก่อนวันคืนห้องตามใบจอง = คืนที่แขกจ่ายไว้แล้วแต่จะไม่ได้นอน กดแล้ว
    // ห้องถูกปล่อยกลับเข้าคลังให้ขายต่อทันที ส่วนยอดที่ลงสมุดรายได้ยังเป็นยอดเต็ม
    // ตามใบจอง (ระบบไม่ลดให้เอง — ถ้าจะคืนเงินต้องแก้ยอดก่อนกดเช็คเอาต์)
    // หน้าจอจึงต้องได้ตัวเลขนี้ไปเตือนก่อน ไม่ใช่รู้ตอนที่ย้อนไม่ได้แล้ว
    const scheduledOutDay = businessDateOf(toBangkokDate(new Date(booking.checkOut)));
    const scheduledInDay = businessDateOf(toBangkokDate(new Date(booking.checkIn)));
    const departureDay = businessDateOf(
      toBangkokDate(booking.actualCheckOut ? new Date(booking.actualCheckOut) : new Date()),
    );
    const scheduledNights = Math.max(
      0,
      Math.round((scheduledOutDay.getTime() - scheduledInDay.getTime()) / DAY_MS),
    );
    const nightsRemaining = Math.max(
      0,
      Math.round((scheduledOutDay.getTime() - departureDay.getTime()) / DAY_MS),
    );

    // Prepare summary object (all fields use defensive fallbacks)
    const summary = {
      booking: {
        id: booking.id,
        roomId: booking.roomId ?? null,
        guestName:
          `${booking.guestFirstName ?? ''} ${booking.guestLastName ?? ''}`.trim() || 'ไม่ระบุ',
        guestEmail: booking.guestEmail ?? null,
        guestPhone: booking.guestPhone ?? null,
        // mapBookingResponse already populates roomNumber/roomType as computed aliases
        roomNumber: booking.room?.number ?? (booking as any).roomNumber ?? 'N/A',
        roomType: booking.room?.type ?? (booking as any).roomType ?? null,
      },
      stay: {
        checkInDate: booking.checkIn,
        checkOutDate: booking.checkOut,
        actualCheckInDate: booking.actualCheckIn ?? null,
        actualCheckOutDate: booking.actualCheckOut ?? null,
        stayDuration: `${stayDuration} คืน`,
        nightCount: stayDuration,
        scheduledNights,
        nightsRemaining,
        isEarlyDeparture: nightsRemaining > 0,
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
        status: booking.paymentStatus ?? 'pending',
        amountPaid,
        balanceRemaining: Math.max(0, balanceRemaining),
      },
    };

    return summary;
  }

  async remove(id: string, tenantId?: string, userId?: string) {
    const booking = await this.findOne(id, tenantId);

    const cancelledBooking = await this.prisma.$transaction(async (tx) => {
      const row = await tx.booking.update({
        where: { id },
        data: { status: 'cancelled' },
        include: {
          property: true,
          room: true,
        },
      });

      // การจองที่เช็คเอาต์ไปแล้วแล้วถูกยกเลิกทีหลัง (คีย์ผิดคน/คืนเงินเต็มจำนวน) มีรายได้
      // ค้างอยู่ในสมุด ต้องดึงกลับด้วย — เรียกดื้อ ๆ ได้ ถ้ายังไม่เคยลงก็คืน 0 ทุกช่อง
      // ยกเลิกข้ามวันจะได้แถวกลับรายการลงวันที่ยกเลิก ไม่ไปแก้ยอดของวันที่ปิดไปแล้ว
      if (tenantId) {
        await this.revenuePosting.voidWithin(tx, {
          tenantId,
          sourceType: 'BOOKING',
          sourceId: id,
          voidedBy: userId || 'system',
          reason: 'ยกเลิกการจอง',
        });
      }

      return row;
    });

    // Send cancellation email (async, non-blocking)
    this.emailEventsService.onBookingCancelled(cancelledBooking).catch((err) => {
      this.logger.error(`Failed to send cancellation email: ${err.message}`);
    });

    // Log cancellation (async, non-blocking)
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_CANCEL,
        resource: AuditResource.BOOKING,
        resourceId: id,
        oldValues: { status: booking.status },
        newValues: { status: 'cancelled' },
        userId: userId || 'system',
        tenantId,
        description: `Booking cancelled for ${booking.guestFirstName} ${booking.guestLastName} (Room ${booking.room?.number || 'N/A'})`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log booking cancellation: ${err.message}`);
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
        dueDate: dueDate.toISOString(),
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
            await this.housekeepingService
              .createTask(
                {
                  roomId: booking.roomId,
                  type: TaskType.INSPECTION,
                  priority: TaskPriority.HIGH,
                  notes: `Collect payment on check-in for booking ${booking.id.slice(0, 8)}. Guest: ${booking.guestFirstName} ${booking.guestLastName}. Amount: THB ${Number(booking.grandTotal ?? booking.totalPrice).toLocaleString()}.`,
                },
                booking.tenantId,
              )
              .catch((e: Error) =>
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

      // Calculate total from invoice items (add-ons / extra charges)
      const additionalCharges =
        invoice.invoice_items?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0;

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

      // Create accounting journal entry (non-blocking — hotel system unaffected if accounting fails)
      this.createBookingRevenueJournal({
        tenantId,
        propertyId: booking?.propertyId,
        bookingId,
        bookingNo: booking?.bookingNo,
        roomSubtotal: Number(booking?.roomSubtotal ?? booking?.totalPrice ?? roomCharge),
        serviceChargeAmount: Number(booking?.serviceChargeAmount ?? 0),
        vatAmount: Number(booking?.vatAmount ?? 0),
        grandTotal: roomCharge,
        additionalCharges,
        totalAmount,
      }).catch((err: Error) => {
        this.logger.warn(`Accounting journal skipped for booking ${bookingId}: ${err.message}`);
      });
    } catch (error) {
      this.logger.error(
        `Failed to finalize invoice on checkout for ${bookingId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Backfill journal entries สำหรับ booking ที่ checkout ไปแล้วแต่ยังไม่มี accounting entry
   * เรียกใช้ครั้งเดียวหลัง seed Chart of Accounts เพื่อสร้าง JE ย้อนหลัง
   */
  async backfillJournalEntries(
    tenantId?: string,
    propertyId?: string,
  ): Promise<{ processed: number; created: number; skipped: number; errors: number }> {
    if (!tenantId) {
      return { processed: 0, created: 0, skipped: 0, errors: 0 };
    }

    const where: any = { tenantId, status: 'checked_out' };
    if (propertyId) where.propertyId = propertyId;

    const bookings = await this.prisma.booking.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        propertyId: true,
        bookingNo: true,
        grandTotal: true,
        totalPrice: true,
        roomSubtotal: true,
        serviceChargeAmount: true,
        vatAmount: true,
      },
    });

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const booking of bookings) {
      try {
        // ตรวจว่ามี journal entry สำหรับ booking นี้แล้วหรือยัง
        const existing = await this.prisma.journalEntry.findFirst({
          where: { tenantId, sourceType: 'BOOKING_PAYMENT', sourceId: booking.id },
          select: { id: true },
        });

        if (existing) {
          skipped++;
          continue;
        }

        const grandTotal = Number(booking.grandTotal ?? booking.totalPrice ?? 0);
        if (grandTotal <= 0) {
          skipped++;
          continue;
        }

        await this.createBookingRevenueJournal({
          tenantId,
          propertyId: booking.propertyId,
          bookingId: booking.id,
          bookingNo: booking.bookingNo,
          roomSubtotal: Number(booking.roomSubtotal ?? booking.totalPrice ?? grandTotal),
          serviceChargeAmount: Number(booking.serviceChargeAmount ?? 0),
          vatAmount: Number(booking.vatAmount ?? 0),
          grandTotal,
          additionalCharges: 0,
          totalAmount: grandTotal,
        });

        created++;
        this.logger.log(`Backfill JE created for booking ${booking.bookingNo ?? booking.id}`);
      } catch (err: unknown) {
        errors++;
        this.logger.error(
          `Backfill JE failed for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Backfill complete: ${bookings.length} processed, ${created} created, ${skipped} skipped, ${errors} errors`,
    );
    return { processed: bookings.length, created, skipped, errors };
  }

  /**
   * สร้าง Journal Entry สำหรับรายได้ห้องพัก (BOOKING_PAYMENT)
   * - DR: เงินสด 1101 = totalAmount
   * - CR: รายได้ค่าห้องพัก 4101 = roomSubtotal
   * - CR: รายได้ค่าธรรมเนียมบริการ 4305 = serviceChargeAmount (ถ้ามี)
   * - CR: ภาษีขาย VAT Output 2103 = vatAmount (ถ้ามี)
   * - CR: รายได้อื่นๆ 4300 = additionalCharges / add-ons (ถ้ามี)
   *
   * ถ้า Chart of Accounts ยังไม่ได้ seed → skip อย่าง graceful ไม่กระทบระบบโรงแรม
   * ถ้าไม่มี add-ons → ไม่มีบรรทัด 4300 ในนั้น ปกติ
   */
  private async createBookingRevenueJournal(params: {
    tenantId: string;
    propertyId?: string;
    bookingId: string;
    bookingNo?: string | null;
    roomSubtotal: number;
    serviceChargeAmount: number;
    vatAmount: number;
    grandTotal: number;
    additionalCharges: number;
    totalAmount: number;
  }): Promise<void> {
    const {
      tenantId,
      propertyId,
      bookingId,
      bookingNo,
      roomSubtotal,
      serviceChargeAmount,
      vatAmount,
      additionalCharges,
      totalAmount,
    } = params;

    if (!propertyId || totalAmount <= 0) return;

    // เช็คเอาต์ซ้ำใบเดิม (ย้อนสถานะแล้วเช็คเอาต์ใหม่ / retry ของหน้าจอ) ต้องไม่ได้ JE
    // เพิ่มอีกใบ — ต่างจากสมุดรายได้ที่ postWithin เขียนทับแถวเดิมได้ ตรงนี้ create
    // ล้วน ๆ ยอดในงบทดลองจึงบวมเป็นสองเท่าเงียบ ๆ ใบที่ถูกกลับรายการไปแล้วสถานะ
    // เป็น REVERSED ไม่ใช่ POSTED จึงเปิดทางให้ลงใหม่ได้ตามต้องการ
    const postedEntry = await this.prisma.journalEntry.findFirst({
      where: {
        tenantId,
        sourceType: 'BOOKING_PAYMENT',
        sourceId: bookingId,
        status: 'POSTED',
      },
      select: { entryNo: true },
    });
    if (postedEntry) {
      this.logger.debug(
        `Accounting journal skipped for booking ${bookingId}: ${postedEntry.entryNo} already posted`,
      );
      return;
    }

    // Look up required accounts — skip if tenant hasn't seeded Chart of Accounts
    const REQUIRED_CODES = ['1101', '4101'];
    const OPTIONAL_CODES = ['2103', '4305', '4300'];
    const allCodes = [...REQUIRED_CODES, ...OPTIONAL_CODES];

    const accounts = await this.prisma.accountChart.findMany({
      where: { tenantId, code: { in: allCodes } },
      select: { id: true, code: true },
    });

    const accountMap = new Map(accounts.map((a) => [a.code, a.id]));

    // Abort if required accounts aren't seeded
    for (const code of REQUIRED_CODES) {
      if (!accountMap.has(code)) {
        this.logger.debug(
          `Accounting journal skipped for booking ${bookingId}: account ${code} not found (Chart of Accounts not seeded)`,
        );
        return;
      }
    }

    // Generate JE number
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'JE', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'JE', prefix: 'JE', yearMonth, lastNumber: 1 },
    });
    const entryNo = `JE-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;

    // Build journal lines
    const lines: Array<{
      accountId: string;
      lineNo: number;
      description: string;
      debit: number;
      credit: number;
    }> = [];

    let lineNo = 1;

    // DR: Cash
    lines.push({
      accountId: accountMap.get('1101')!,
      lineNo: lineNo++,
      description: `รับชำระห้องพัก ${bookingNo ?? bookingId.slice(0, 8)}`,
      debit: totalAmount,
      credit: 0,
    });

    // CR: Room Revenue — use grandTotal if no breakdown, else roomSubtotal
    const hasBreakdown = serviceChargeAmount > 0 || vatAmount > 0;
    const roomRevenueAmount = hasBreakdown ? roomSubtotal : params.grandTotal;
    lines.push({
      accountId: accountMap.get('4101')!,
      lineNo: lineNo++,
      description: `รายได้ค่าห้องพัก ${bookingNo ?? bookingId.slice(0, 8)}`,
      debit: 0,
      credit: roomRevenueAmount,
    });

    // CR: Service Charge (4305) — if applicable and account exists
    if (serviceChargeAmount > 0 && accountMap.has('4305')) {
      lines.push({
        accountId: accountMap.get('4305')!,
        lineNo: lineNo++,
        description: `ค่าธรรมเนียมบริการ ${bookingNo ?? bookingId.slice(0, 8)}`,
        debit: 0,
        credit: serviceChargeAmount,
      });
    }

    // CR: VAT Output (2103) — if applicable and account exists
    if (vatAmount > 0 && accountMap.has('2103')) {
      lines.push({
        accountId: accountMap.get('2103')!,
        lineNo: lineNo++,
        description: `ภาษีมูลค่าเพิ่ม (VAT) ${bookingNo ?? bookingId.slice(0, 8)}`,
        debit: 0,
        credit: vatAmount,
      });
    }

    // CR: Other Revenue (4300) — add-ons / extra charges only if > 0
    if (additionalCharges > 0 && accountMap.has('4300')) {
      lines.push({
        accountId: accountMap.get('4300')!,
        lineNo: lineNo++,
        description: `รายได้บริการเพิ่มเติม (add-ons) ${bookingNo ?? bookingId.slice(0, 8)}`,
        debit: 0,
        credit: additionalCharges,
      });
    }

    // Verify double-entry balances before persisting
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      this.logger.error(
        `Journal entry imbalance for booking ${bookingId}: debit ${totalDebit} ≠ credit ${totalCredit}`,
      );
      return;
    }

    const fiscalPeriod = now.getMonth() + 1;
    const fiscalYear = now.getFullYear();

    // JE + ledger_balances ต้องอยู่ transaction เดียวกัน — งบทดลอง/งบกำไรขาดทุนอ่านจาก
    // ledger_balances ไม่ใช่ journal_entries ถ้าไม่บวกยอดตรงนี้ หน้าบัญชีจะขึ้น 0
    await this.prisma.$transaction(async (tx) => {
      await tx.journalEntry.create({
        data: {
          tenantId,
          propertyId,
          entryNo,
          entryDate: now,
          description: `รับชำระห้องพัก ${bookingNo ?? bookingId.slice(0, 8)}`,
          reference: bookingNo ?? bookingId.slice(0, 8),
          sourceType: 'BOOKING_PAYMENT',
          sourceId: bookingId,
          status: 'POSTED',
          fiscalPeriod,
          fiscalYear,
          totalDebit,
          totalCredit,
          createdBy: 'system',
          lines: {
            create: lines.map((l) => ({
              accountId: l.accountId,
              lineNo: l.lineNo,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
            })),
          },
        },
      });

      await applyLedgerBalances(tx, { tenantId, propertyId, fiscalYear, fiscalPeriod }, lines);
    });

    this.logger.log(
      `Journal entry ${entryNo} created for booking ${bookingId}: total ${totalAmount} THB` +
        (additionalCharges > 0 ? ` (incl. add-ons ${additionalCharges})` : ''),
    );
  }

  /**
   * กลับรายการ JE ของการจอง เมื่อเช็คเอาต์ถูกย้อนสถานะ
   *
   * ลบ JE ทิ้งไม่ได้ — สมุดรายวันต้องเดินหน้าอย่างเดียว จึงออกใบกลับรายการที่สลับ
   * เดบิต/เครดิต แล้วปั๊มใบเดิมเป็น REVERSED (ซึ่งพ่วงเป็นตัวปลดล็อกให้เช็คเอาต์
   * รอบใหม่ลง JE ได้อีกครั้ง ดู guard ใน createBookingRevenueJournal)
   *
   * `ledger_balances` ต้องขยับในทรานแซกชันเดียวกัน เพราะงบทดลอง/งบกำไรขาดทุน
   * อ่านจากตารางนั้น ไม่ได้อ่านจาก journal_entries
   */
  private async reverseBookingRevenueJournal(
    bookingId: string,
    tenantId: string,
    reversedBy: string,
  ): Promise<void> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: {
        tenantId,
        sourceType: 'BOOKING_PAYMENT',
        sourceId: bookingId,
        status: 'POSTED',
      },
      include: { lines: true },
    });
    if (!entry) return;

    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await this.prisma.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'JE', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'JE', prefix: 'JE', yearMonth, lastNumber: 1 },
    });
    const entryNo = `JE-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;

    const reversalLines = entry.lines
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((line, index) => ({
        accountId: line.accountId,
        lineNo: index + 1,
        description: `กลับรายการ: ${line.description ?? ''}`.trim(),
        debit: Number(line.credit),
        credit: Number(line.debit),
      }));

    const fiscalPeriod = now.getMonth() + 1;
    const fiscalYear = now.getFullYear();

    await this.prisma.$transaction(async (tx) => {
      const reversal = await tx.journalEntry.create({
        data: {
          tenantId,
          propertyId: entry.propertyId,
          entryNo,
          entryDate: now,
          description: `กลับรายการ ${entry.entryNo} (ย้อนสถานะเช็คเอาต์)`,
          reference: entry.entryNo,
          sourceType: 'ADJUSTMENT',
          sourceId: bookingId,
          status: 'POSTED',
          fiscalPeriod,
          fiscalYear,
          totalDebit: entry.totalCredit,
          totalCredit: entry.totalDebit,
          reversedById: entry.id,
          createdBy: reversedBy,
          postedBy: reversedBy,
          postedAt: now,
          lines: { create: reversalLines },
        },
        select: { id: true },
      });

      await tx.journalEntry.update({
        where: { id: entry.id },
        data: { status: 'REVERSED', reversedById: reversal.id, reversedAt: now },
      });

      await applyLedgerBalances(
        tx,
        { tenantId, propertyId: entry.propertyId, fiscalYear, fiscalPeriod },
        reversalLines,
      );
    });

    this.logger.log(
      `Journal entry ${entry.entryNo} reversed by ${entryNo} for booking ${bookingId}`,
    );
  }

  /**
   * Walk-in guest — create booking + check-in in one operation
   * Receptionist can register a guest and immediately check them into a room
   * Returns booking with guest and room information
   */
  async walkIn(walkInDto: any, tenantId?: string, defaultPropertyId?: string): Promise<any> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const {
      guestFirstName,
      guestLastName,
      guestEmail,
      guestPhone,
      roomId,
      propertyId,
      nights,
      notes,
    } = walkInDto;

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

    // Check room availability (walk-in: check-in = now, check-out = now + nights days)
    const now = new Date();
    const checkOutDate = new Date();
    checkOutDate.setDate(checkOutDate.getDate() + nights);

    // overlap condition: existing.scheduledCheckIn < newCheckOut AND existing.scheduledCheckOut > newCheckIn
    const [existingBooking, existingBookingFallback] = await Promise.all([
      // Primary: ใช้ scheduledCheckIn/Out (time-aware)
      this.prisma.booking.findFirst({
        where: {
          roomId,
          tenantId,
          status: { in: ['pending', 'confirmed', 'checked_in'] },
          scheduledCheckIn: { lt: checkOutDate },
          scheduledCheckOut: { gt: now },
        },
      }),
      // Fallback: booking เก่าที่ไม่มี scheduledCheckIn
      this.prisma.booking.findFirst({
        where: {
          roomId,
          tenantId,
          status: { in: ['pending', 'confirmed', 'checked_in'] },
          scheduledCheckIn: null,
          checkIn: { lt: checkOutDate },
          checkOut: { gt: now },
        },
      }),
    ]);

    if (existingBooking || existingBookingFallback) {
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
      totalCapacity:
        Number(room.maxOccupancy ?? 0) +
        (room.extraBedAllowed ? Number(room.extraBedLimit ?? 0) : 0),
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
      this.logger.error(
        `Failed to auto-generate invoice for walk-in booking ${booking.id}: ${err.message}`,
      );
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
    this.emailEventsService.onBookingCheckIn(booking).catch((err) => {
      this.logger.error(`Failed to send walk-in check-in email: ${err.message}`);
    });

    this.logger.log(
      `Walk-in booking created and checked in: ${booking.id} for guest ${guestFirstName} ${guestLastName} in Room ${room.number}`,
    );

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

    const feeAmount = property.earlyCheckInFeeAmount ? Number(property.earlyCheckInFeeAmount) : 0;

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

    // Audit log (async, non-blocking)
    this.auditLogService
      .log({
        action: approve
          ? AuditAction.BOOKING_EARLY_CHECKIN_APPROVE
          : AuditAction.BOOKING_EARLY_CHECKIN_REQUEST,
        resource: AuditResource.BOOKING,
        resourceId: id,
        newValues: {
          requestedEarlyCheckIn: true,
          ...(approve && { approvedEarlyCheckIn: true, earlyCheckInFee: feeAmount }),
        },
        tenantId,
        description: approve
          ? `Early check-in approved for ${booking.guestFirstName} ${booking.guestLastName} | Fee: ฿${feeAmount}`
          : `Early check-in requested for ${booking.guestFirstName} ${booking.guestLastName}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log early check-in: ${err.message}`);
      });

    return this.mapBookingResponse(updated);
  }

  /**
   * Manager/admin approves a pending early check-in request.
   */
  async approveEarlyCheckIn(
    id: string,
    tenantId: string | undefined,
    userId?: string,
  ): Promise<unknown> {
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

    const feeAmount = property?.earlyCheckInFeeAmount ? Number(property.earlyCheckInFeeAmount) : 0;

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        approvedEarlyCheckIn: true,
        earlyCheckInFee: feeAmount,
      },
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(`Early check-in approved for booking ${id} | fee: ${feeAmount}`);

    // Audit log (async, non-blocking)
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_EARLY_CHECKIN_APPROVE,
        resource: AuditResource.BOOKING,
        resourceId: id,
        newValues: { approvedEarlyCheckIn: true, earlyCheckInFee: feeAmount },
        userId: userId || 'system',
        tenantId,
        description: `Early check-in approved for ${booking.guestFirstName} ${booking.guestLastName} | Fee: ฿${feeAmount}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log early check-in approval: ${err.message}`);
      });

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

    const feeAmount = property.lateCheckOutFeeAmount ? Number(property.lateCheckOutFeeAmount) : 0;

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

    // Audit log (async, non-blocking)
    this.auditLogService
      .log({
        action: approve
          ? AuditAction.BOOKING_LATE_CHECKOUT_APPROVE
          : AuditAction.BOOKING_LATE_CHECKOUT_REQUEST,
        resource: AuditResource.BOOKING,
        resourceId: id,
        newValues: {
          requestedLateCheckOut: true,
          ...(approve && { approvedLateCheckOut: true, lateCheckOutFee: feeAmount }),
        },
        tenantId,
        description: approve
          ? `Late check-out approved for ${booking.guestFirstName} ${booking.guestLastName} | Fee: ฿${feeAmount}`
          : `Late check-out requested for ${booking.guestFirstName} ${booking.guestLastName}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log late check-out: ${err.message}`);
      });

    return this.mapBookingResponse(updated);
  }

  /**
   * Manager/admin approves a pending late check-out request.
   */
  async approveLateCheckOut(
    id: string,
    tenantId: string | undefined,
    userId?: string,
  ): Promise<unknown> {
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

    const feeAmount = property?.lateCheckOutFeeAmount ? Number(property.lateCheckOutFeeAmount) : 0;

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        approvedLateCheckOut: true,
        lateCheckOutFee: feeAmount,
      },
      include: { guest: true, room: true, property: true },
    });

    this.logger.log(`Late check-out approved for booking ${id} | fee: ${feeAmount}`);

    // Audit log (async, non-blocking)
    this.auditLogService
      .log({
        action: AuditAction.BOOKING_LATE_CHECKOUT_APPROVE,
        resource: AuditResource.BOOKING,
        resourceId: id,
        newValues: { approvedLateCheckOut: true, lateCheckOutFee: feeAmount },
        userId: userId || 'system',
        tenantId,
        description: `Late check-out approved for ${booking.guestFirstName} ${booking.guestLastName} | Fee: ฿${feeAmount}`,
      })
      .catch((err) => {
        this.logger.error(`Failed to log late check-out approval: ${err.message}`);
      });

    return this.mapBookingResponse(updated);
  }

  // ─── Booking Activity Timeline ────────────────────────────────────────────

  /**
   * Get activity timeline for a booking.
   * Returns all audit log entries related to this booking, enriched with user info,
   * formatted for display in the booking detail page.
   */
  async getBookingActivities(
    bookingId: string,
    tenantId: string | undefined,
    page = 1,
    limit = 50,
  ): Promise<{
    activities: BookingActivityItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify booking exists and belongs to tenant
    await this.findOne(bookingId, tenantId);

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          resource: AuditResource.BOOKING,
          resourceId: bookingId,
          tenantId,
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({
        where: {
          resource: AuditResource.BOOKING,
          resourceId: bookingId,
          tenantId,
        },
      }),
    ]);

    // Collect unique userIds to enrich with user names
    const userIds = [...new Set(logs.map((l) => l.userId).filter((uid): uid is string => !!uid))];
    const users =
      userIds.length > 0
        ? await this.prisma.user
            .findMany({
              where: { id: { in: userIds } },
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
            })
            .catch(() => [])
        : [];

    const userMap = new Map(users.map((u: any) => [u.id, u]));

    const activities = logs.map((log) => this.mapLogToActivity(log, userMap));

    return { activities, total, page, limit };
  }

  private mapLogToActivity(log: any, userMap: Map<string, any>): BookingActivityItem {
    const user = log.userId ? userMap.get(log.userId) : null;
    const performedBy: ActivityPerformer = user
      ? {
          id: user.id,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
            user.email ||
            'ผู้ใช้',
          role: user.role || 'staff',
        }
      : { id: 'system', name: 'ระบบอัตโนมัติ', role: 'system' };

    const changes = this.buildActivityChanges(
      log.oldValues as Record<string, unknown> | null,
      log.newValues as Record<string, unknown> | null,
    );

    return {
      id: log.id,
      action: log.action,
      actionLabel: this.getActivityActionLabel(log.action),
      description: log.description || '',
      performedBy,
      timestamp: log.createdAt.toISOString(),
      changes: Object.keys(changes).length > 0 ? changes : null,
      category: log.resource,
      icon: this.getActivityIcon(log.action),
      color: this.getActivityColor(log.action),
    };
  }

  private buildActivityChanges(
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown> | null,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (!oldValues && !newValues) return changes;

    const allKeys = new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]);

    for (const key of allKeys) {
      const from = oldValues?.[key] ?? null;
      const to = newValues?.[key] ?? null;
      if (from !== to) {
        changes[key] = { from, to };
      }
    }

    return changes;
  }

  private getActivityActionLabel(action: string): string {
    const labels: Record<string, string> = {
      booking_create: 'สร้างการจอง',
      booking_confirm: 'ยืนยันการจอง',
      booking_update: 'แก้ไขการจอง',
      booking_cancel: 'ยกเลิกการจอง',
      booking_checkin: 'เช็คอิน',
      booking_checkout: 'เช็คเอาท์',
      booking_checkout_undo: 'ย้อนสถานะเช็คเอาท์',
      booking_early_checkin_request: 'ขอ Early Check-in',
      booking_early_checkin_approve: 'อนุมัติ Early Check-in',
      booking_late_checkout_request: 'ขอ Late Check-out',
      booking_late_checkout_approve: 'อนุมัติ Late Check-out',
      booking_folio_charge: 'เพิ่มค่าใช้จ่าย',
      booking_folio_finalize: 'ปิดยอดใบเสร็จ',
      booking_payment: 'ชำระเงิน',
      booking_note_update: 'อัปเดตหมายเหตุ',
      payment_create: 'สร้างรายการชำระเงิน',
      payment_approve: 'อนุมัติการชำระเงิน',
      housekeeping_task_complete: 'แม่บ้านทำความสะอาดเสร็จ',
      room_status_change: 'เปลี่ยนสถานะห้อง',
    };
    return labels[action] || action;
  }

  private getActivityIcon(action: string): string {
    const icons: Record<string, string> = {
      booking_create: 'plus-circle',
      booking_confirm: 'check-circle',
      booking_update: 'edit',
      booking_cancel: 'x-circle',
      booking_checkin: 'log-in',
      booking_checkout: 'log-out',
      booking_checkout_undo: 'rotate-ccw',
      booking_early_checkin_request: 'clock',
      booking_early_checkin_approve: 'check-square',
      booking_late_checkout_request: 'clock',
      booking_late_checkout_approve: 'check-square',
      booking_folio_charge: 'receipt',
      booking_folio_finalize: 'file-check',
      booking_payment: 'credit-card',
      booking_note_update: 'message-square',
      payment_create: 'credit-card',
      payment_approve: 'badge-check',
      housekeeping_task_complete: 'sparkles',
      room_status_change: 'door-open',
    };
    return icons[action] || 'activity';
  }

  private getActivityColor(action: string): string {
    const colors: Record<string, string> = {
      booking_create: 'blue',
      booking_confirm: 'green',
      booking_update: 'amber',
      booking_cancel: 'red',
      booking_checkin: 'indigo',
      booking_checkout: 'gray',
      booking_checkout_undo: 'orange',
      booking_early_checkin_request: 'amber',
      booking_early_checkin_approve: 'green',
      booking_late_checkout_request: 'amber',
      booking_late_checkout_approve: 'green',
      booking_folio_charge: 'purple',
      booking_folio_finalize: 'teal',
      booking_payment: 'emerald',
      booking_note_update: 'slate',
      payment_create: 'emerald',
      payment_approve: 'green',
      housekeeping_task_complete: 'teal',
      room_status_change: 'cyan',
    };
    return colors[action] || 'gray';
  }
}
