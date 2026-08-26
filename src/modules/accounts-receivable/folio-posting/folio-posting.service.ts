import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { FolioChargeType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { bangkokDayRange, toBangkokDate } from '@/common/utils/bangkok-day.util';

/**
 * Booking statuses that may still sign charges to their room. A checked-out or
 * cancelled booking must not accept new charges — that is how a bill escapes
 * the folio and never gets collected.
 */
const CHARGEABLE_BOOKING_STATUSES = ['checked_in', 'confirmed'] as const;

/**
 * การจองที่ "อยู่ในโรงแรมวันนี้" — คาบเกี่ยวกับวันนี้ตามเวลาไทย
 *
 * สถานะอย่างเดียวไม่พอ: การจอง confirmed ของเดือนหน้าก็ผ่านเงื่อนไขสถานะ ถ้าไม่คุม
 * ช่วงวันด้วย ห้อง 101 ที่ว่างอยู่แต่มีคนจองไว้เดือนหน้า จะดูดยอดของวันนี้เข้าไปได้
 */
const staysToday = (): Prisma.BookingWhereInput => {
  const { start, end } = bangkokDayRange(toBangkokDate(new Date()));
  return {
    OR: [
      { checkIn: { lt: end }, checkOut: { gte: start } },
      { scheduledCheckIn: { lt: end }, scheduledCheckOut: { gte: start } },
    ],
  };
};

/** `sourceType` values written on FolioCharge rows, one per posting channel. */
export const FOLIO_SOURCE_TYPE = {
  RESTAURANT_ORDER: 'RESTAURANT_ORDER',
  RETAIL_SALE: 'RETAIL_SALE',
} as const;

export type FolioSourceType = (typeof FOLIO_SOURCE_TYPE)[keyof typeof FOLIO_SOURCE_TYPE];

export interface PostFolioChargeInput {
  tenantId: string;
  /** The booking that signs for the charge. Preferred over `roomNumber`. */
  bookingId?: string | null;
  /**
   * Free-text room number, used only when the caller has no bookingId (older
   * screens). Resolved to a single in-house booking or the post is rejected.
   */
  roomNumber?: string | null;
  /** Narrows the room-number lookup when the tenant runs several properties. */
  propertyId?: string | null;
  chargeType: FolioChargeType;
  description: string;
  /** Amount before VAT. */
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  /** Amount the guest owes — what lands on the folio balance. */
  totalAmount: number;
  sourceType: FolioSourceType;
  sourceId: string;
  postedBy: string;
}

/** หนึ่งห้องที่รับชาร์จได้จริง ณ ตอนนี้ — รูปแบบที่หน้าจอ POS/ร้านค้าเอาไปทำตัวเลือก */
export interface ChargeableRoom {
  roomNumber: string;
  guestName: string;
  bookingId: string;
  status: string;
  /** ห้องจริงที่ผูกกับการจองนี้ — เลขห้องเป็นข้อความที่ถูกเปลี่ยนทีหลังได้ ประวัติจึงต้องยึด id */
  roomId: string;
  /** สาขาของห้อง — ฝั่งมินิบาร์ใช้หาคลังมินิบาร์ของสาขานั้นต่อ */
  propertyId: string;
}

export interface PostedFolioCharge {
  folioId: string;
  chargeId: string;
  bookingId: string;
  guestId: string;
  propertyId: string;
  /** true when an existing charge for the same source document was reused. */
  alreadyPosted: boolean;
}

/**
 * Posts charges raised outside the hotel module (restaurant POS, retail shop)
 * onto the in-house guest's folio.
 *
 * Before this service existed, both channels validated a room number and then
 * marked the sale PAID without creating a FolioCharge — the guest signed for a
 * meal and was never billed for it at checkout. Every room-charge path must go
 * through `postCharge`, which is idempotent on (sourceType, sourceId) so a retry
 * re-uses the charge instead of double-billing the room.
 *
 * Deliberately depends on nothing but Prisma so the restaurant and inventory
 * modules can import it without pulling in the accounting add-on graph.
 */
@Injectable()
export class FolioPostingService {
  private readonly logger = new Logger(FolioPostingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Charge a sale to a guest's room, opening the folio on first use.
   *
   * Throws when the room cannot be tied to exactly one chargeable booking —
   * failing at the till is the point. A silent fallback here is the money-loss
   * bug this service replaces.
   */
  async postCharge(input: PostFolioChargeInput): Promise<PostedFolioCharge> {
    return this.prisma.$transaction((tx) => this.postChargeWithin(tx, input));
  }

  /**
   * Same as {@link postCharge} but joins a transaction the caller already owns,
   * so a sale and the folio charge that backs it commit or fail together.
   */
  async postChargeWithin(
    tx: Prisma.TransactionClient,
    input: PostFolioChargeInput,
  ): Promise<PostedFolioCharge> {
    const { tenantId, sourceType, sourceId } = input;

    // Idempotency first: a retried payment must not bill the room twice.
    const existing = await tx.folioCharge.findFirst({
      where: { tenantId, sourceType, sourceId, status: 'POSTED' },
    });
    if (existing) {
      const folio = await tx.guestFolio.findFirst({
        where: { id: existing.folioId, tenantId },
        select: { id: true, bookingId: true, guestId: true, propertyId: true },
      });
      if (folio) {
        this.logger.debug(`Folio charge for ${sourceType}:${sourceId} already posted, reusing`);
        return {
          folioId: folio.id,
          chargeId: existing.id,
          bookingId: folio.bookingId,
          guestId: folio.guestId,
          propertyId: folio.propertyId,
          alreadyPosted: true,
        };
      }
    }

    const booking = await this.resolveBooking(tx, input);
    const guestId = await this.ensureGuest(tx, booking, tenantId);

    const folio = await this.findOrCreateFolio(tx, {
      tenantId,
      bookingId: booking.id,
      guestId,
      propertyId: booking.propertyId,
      roomId: booking.roomId,
      checkInDate: booking.checkIn,
      createdBy: input.postedBy,
    });

    const charge = await tx.folioCharge.create({
      data: {
        tenantId,
        propertyId: folio.propertyId,
        folioId: folio.id,
        chargeDate: new Date(),
        chargeType: input.chargeType,
        description: input.description,
        quantity: 1,
        unitPrice: input.netAmount,
        netAmount: input.netAmount,
        vatRate: input.vatRate,
        vatAmount: input.vatAmount,
        totalAmount: input.totalAmount,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        isAutoPosted: true,
        postedBy: input.postedBy,
        status: 'POSTED',
      },
    });

    await tx.guestFolio.update({
      where: { id: folio.id },
      data: {
        totalCharges: { increment: input.totalAmount },
        balance: { increment: input.totalAmount },
      },
    });

    this.logger.log(
      `Charged ${input.totalAmount} to folio ${folio.folioNo} (${sourceType}:${sourceId})`,
    );

    return {
      folioId: folio.id,
      chargeId: charge.id,
      bookingId: booking.id,
      guestId,
      propertyId: folio.propertyId,
      alreadyPosted: false,
    };
  }

  /**
   * Reverse a charge previously posted from `sourceType`/`sourceId` (bill voided
   * at the POS). No-op when nothing was posted, so callers can call it blindly.
   */
  async reverseCharge(
    tenantId: string,
    sourceType: FolioSourceType,
    sourceId: string,
    reversedBy: string,
  ): Promise<boolean> {
    const charge = await this.prisma.folioCharge.findFirst({
      where: { tenantId, sourceType, sourceId, status: 'POSTED' },
    });
    if (!charge) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.folioCharge.update({
        where: { id: charge.id },
        data: { status: 'REVERSED', isReversed: true, reversedBy, reversedAt: new Date() },
      });
      await tx.guestFolio.update({
        where: { id: charge.folioId },
        data: {
          totalCharges: { decrement: Number(charge.totalAmount) },
          balance: { decrement: Number(charge.totalAmount) },
        },
      });
    });

    this.logger.log(`Reversed folio charge ${charge.id} (${sourceType}:${sourceId})`);
    return true;
  }

  /**
   * ห้องที่ `postCharge` จะยอมรับ ถ้าเลือกจากรายการนี้
   *
   * ทุกหน้าจอที่มีปุ่ม "ชาร์จเข้าห้อง" ต้องดึงตัวเลือกจากที่นี่ที่เดียว ไม่งั้นจอกับ
   * ตัวโพสต์จะนิยาม "ห้องที่ชาร์จได้" คนละแบบ — พนักงานเลือกห้องที่ระบบไม่รับ
   * แล้วปิดบิลไม่ได้ทั้งที่จอบอกว่าเลือกได้
   */
  async listChargeableRooms(params: {
    tenantId: string;
    propertyId?: string | null;
    search?: string;
  }): Promise<ChargeableRoom[]> {
    const where: Prisma.BookingWhereInput = {
      tenantId: params.tenantId,
      status: { in: [...CHARGEABLE_BOOKING_STATUSES] },
      AND: [staysToday()],
    };
    if (params.propertyId) where.propertyId = params.propertyId;

    // ค้นหาไปอยู่ใน AND เพราะ staysToday() ใช้ OR อยู่แล้ว ถ้าเขียนทับ where.OR
    // เงื่อนไขช่วงวันจะหายไปเงียบ ๆ แล้วรายการจะโผล่การจองเดือนหน้าขึ้นมา
    const search = params.search?.trim();
    if (search) {
      (where.AND as Prisma.BookingWhereInput[]).push({
        OR: [
          { room: { number: { contains: search } } },
          { guestFirstName: { contains: search } },
          { guestLastName: { contains: search } },
        ],
      });
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      select: {
        id: true,
        status: true,
        propertyId: true,
        guestFirstName: true,
        guestLastName: true,
        room: { select: { id: true, number: true, propertyId: true } },
        guest: { select: { firstName: true, lastName: true } },
      },
      orderBy: { room: { number: 'asc' } },
    });

    return bookings
      // การจองที่ยังไม่ได้ผูกห้องชาร์จเข้าห้องไม่ได้ ไม่ต้องเอามาให้เลือก
      .filter((b) => b.room?.number)
      .map((b) => ({
        roomNumber: b.room!.number,
        guestName:
          [b.guest?.firstName ?? b.guestFirstName, b.guest?.lastName ?? b.guestLastName]
            .filter(Boolean)
            .join(' ')
            .trim() || '-',
        bookingId: b.id,
        status: b.status,
        roomId: b.room!.id,
        propertyId: b.room!.propertyId,
      }));
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /**
   * Find the booking that signs for the charge. An explicit bookingId wins; a
   * bare room number is resolved against in-house bookings and must match
   * exactly one, otherwise the caller has to disambiguate.
   */
  private async resolveBooking(tx: Prisma.TransactionClient, input: PostFolioChargeInput) {
    const select = {
      id: true,
      tenantId: true,
      propertyId: true,
      roomId: true,
      guestId: true,
      guestFirstName: true,
      guestLastName: true,
      guestEmail: true,
      guestPhone: true,
      checkIn: true,
      status: true,
    } as const;

    if (input.bookingId) {
      const booking = await tx.booking.findFirst({
        where: { id: input.bookingId, tenantId: input.tenantId },
        select,
      });
      if (!booking) {
        throw new BadRequestException('ไม่พบการจองห้องพักนี้ในองค์กรของคุณ');
      }
      if (!this.isChargeable(booking.status)) {
        throw new BadRequestException(
          `การจองนี้อยู่ในสถานะ "${booking.status}" จึงชาร์จเข้าห้องไม่ได้ กรุณาเก็บเงินด้วยวิธีอื่น`,
        );
      }
      return booking;
    }

    const roomNumber = input.roomNumber?.trim();
    if (!roomNumber) {
      throw new BadRequestException('ต้องเลือกห้องพัก (การจอง) ก่อนชาร์จเข้าห้อง');
    }

    // คุมช่วงวันด้วย ไม่ใช่แค่สถานะ ไม่งั้นห้องที่ว่างอยู่วันนี้แต่มีคนจองไว้เดือนหน้า
    // จะรับยอดของวันนี้ไปลง folio ของแขกที่ยังไม่มาเข้าพัก
    const where: Prisma.BookingWhereInput = {
      tenantId: input.tenantId,
      status: { in: [...CHARGEABLE_BOOKING_STATUSES] },
      room: { number: roomNumber },
      AND: [staysToday()],
    };
    if (input.propertyId) where.propertyId = input.propertyId;

    const matches = await tx.booking.findMany({
      where,
      select,
      orderBy: { checkIn: 'desc' },
      take: 2,
    });

    if (matches.length === 0) {
      throw new BadRequestException(
        `ห้อง ${roomNumber} ไม่มีแขกที่เช็คอินอยู่ จึงชาร์จเข้าห้องไม่ได้`,
      );
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `ห้อง ${roomNumber} มีการจองที่เข้าเงื่อนไขมากกว่า 1 รายการ กรุณาเลือกการจองที่ต้องการชาร์จ`,
      );
    }
    return matches[0];
  }

  private isChargeable(status: string): boolean {
    return (CHARGEABLE_BOOKING_STATUSES as readonly string[]).includes(status);
  }

  /**
   * GuestFolio.guestId is required but Booking.guestId is not, so a booking taken
   * without a guest profile would block the till. The booking already carries the
   * guest's name — promote it to a Guest row and link it back rather than failing
   * the sale.
   */
  private async ensureGuest(
    tx: Prisma.TransactionClient,
    booking: {
      id: string;
      guestId: string | null;
      guestFirstName: string;
      guestLastName: string;
      guestEmail: string | null;
      guestPhone: string | null;
    },
    tenantId: string,
  ): Promise<string> {
    if (booking.guestId) return booking.guestId;

    const guest = await tx.guest.create({
      data: {
        tenantId,
        firstName: booking.guestFirstName,
        lastName: booking.guestLastName,
        email: booking.guestEmail,
        phone: booking.guestPhone,
      },
    });
    await tx.booking.update({
      where: { id: booking.id },
      data: { guestId: guest.id },
    });

    this.logger.warn(
      `Booking ${booking.id} had no guest profile; created guest ${guest.id} to open its folio`,
    );
    return guest.id;
  }

  private async findOrCreateFolio(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      bookingId: string;
      guestId: string;
      propertyId: string;
      roomId: string | null;
      checkInDate: Date;
      createdBy: string;
    },
  ) {
    const existing = await tx.guestFolio.findFirst({
      where: { bookingId: params.bookingId, tenantId: params.tenantId, status: 'OPEN' },
    });
    if (existing) return existing;

    const closed = await tx.guestFolio.findFirst({
      where: { bookingId: params.bookingId, tenantId: params.tenantId },
      select: { status: true, folioNo: true },
    });
    if (closed) {
      throw new BadRequestException(
        `บิลห้องพัก ${closed.folioNo} ถูกปิดแล้ว (${closed.status}) จึงเพิ่มรายการไม่ได้`,
      );
    }

    const folioNo = await this.generateFolioNo(tx, params.tenantId);
    return tx.guestFolio.create({
      data: {
        tenantId: params.tenantId,
        propertyId: params.propertyId,
        bookingId: params.bookingId,
        guestId: params.guestId,
        roomId: params.roomId,
        folioNo,
        status: 'OPEN',
        checkInDate: params.checkInDate,
        openDate: new Date(),
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
        createdBy: params.createdBy,
      },
    });
  }

  /** Per-tenant, per-month folio number drawn from document_sequences. */
  private async generateFolioNo(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const seq = await tx.documentSequence.upsert({
      where: { tenantId_docType_yearMonth: { tenantId, docType: 'FOLIO', yearMonth } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: 'FOLIO', prefix: 'FOLIO', yearMonth, lastNumber: 1 },
    });
    return `FOLIO-${yearMonth}-${String(seq.lastNumber).padStart(6, '0')}`;
  }
}
