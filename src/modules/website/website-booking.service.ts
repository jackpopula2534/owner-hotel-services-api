import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Room, WebsiteSite } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { BookingsService, BookingPricingSummary } from '../bookings/bookings.service';
import { CreateBookingDto } from '../bookings/dto/create-booking.dto';
import {
  UNBOOKABLE_ROOM_STATUSES,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  applyCleaningBuffer,
  buildBangkokDateTime,
  resolveTimeWithFallback,
} from '../../common/availability/availability.util';
import { PropertyHolidaysService } from '../properties/property-holidays.service';
import { PropertyPromoCodesService } from '../properties/property-promo-codes.service';
import { PromoRule, promoStayIneligibility } from '../bookings/promo-discount';
import { WebsiteEntitlementService } from './website-entitlement.service';
import { WebsitePublicService } from './website-public.service';
import { WebsitePaymentService, WebsitePromptPayInfo } from './website-payment.service';
import { DepositPolicy, allocateDue, depositDue } from './website-deposit';
import { LocalizedText, SiteContent, sanitizeSiteContent } from './website-content';
import { CreateWebsiteBookingDto, WebsiteAvailabilityQueryDto } from './dto/website-booking.dto';

/** สถานะที่กันห้อง — ต้องตรงกับ BookingsService.create() */
const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];
const BOOKING_LOCK_WAIT_SECONDS = 10;
const CONSENT_VERSION = 'website-1';

export interface StayQuote {
  nights: number;
  nightlyRates: Array<{
    date: string;
    rate: number;
    label: string;
    type: 'base' | 'weekend' | 'holiday' | 'seasonal';
  }>;
  /** ก่อนค่าบริการ/VAT — รวมค่าเตียงเสริมแล้ว หักส่วนลดแล้ว */
  roomSubtotal: number;
  /** ส่วนลดจากโค้ดโปรโมชัน (หักจากค่าห้องก่อนคิดค่าบริการ/VAT) */
  discount: { code: string; amount: number; subtotalBeforeDiscount: number } | null;
  extraBeds: { guests: number; ratePerNight: number; nights: number; amount: number } | null;
  serviceChargePercent: number;
  serviceChargeAmount: number;
  vatPercent: number;
  vatAmount: number;
  grandTotal: number;
  /** มัดจำที่ต้องโอน PromptPay ตอนจอง — null = โอนเต็มจำนวน (หรือโรงแรมไม่รับ PromptPay) */
  depositDue: number | null;
  currency: 'THB';
}

export interface RoomTypeAvailability {
  key: string;
  /** จำนวนห้องว่างที่รับแขกจำนวนนี้ได้ */
  available: number;
  /** FULL = ไม่มีห้องว่าง, CAPACITY = ว่างแต่ไม่พอสำหรับจำนวนแขก */
  reason: 'FULL' | 'CAPACITY' | null;
  quote: StayQuote | null;
  /** ความจุของห้องที่รับได้มากสุดในประเภทนี้ — ใช้ทำตัวนับแขก/แถบความจุบนหน้าเว็บ */
  capacity: RoomCapacity | null;
}

export interface RoomCapacity {
  maxOccupancy: number;
  extraBedLimit: number;
  extraBedPrice: number;
  /** เด็กพักฟรี ไม่นับเป็นผู้เข้าพัก/ไม่ต้องใช้เตียงเสริม */
  childFree: boolean;
  childFreeNote: string | null;
}

export interface WebsiteAvailability {
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  roomTypes: RoomTypeAvailability[];
  /** ผลตรวจโค้ดส่วนลด (null = ไม่ได้ใส่โค้ด) — message บอกเหตุผลที่ใช้ไม่ได้ */
  promo: PromoStatus | null;
  /** วิธีชำระที่เปิดให้แขกเลือก — PromptPay เฉพาะโรงแรมที่ตั้งบัญชีรับเงินไว้ */
  payment: {
    promptpay: boolean;
    accountName: string | null;
    /** นโยบายมัดจำเมื่อโอน PromptPay (null = ไม่รับ PromptPay) */
    deposit: DepositPolicy | null;
  };
}

export interface PromoStatus {
  code: string;
  /** ใช้ได้กับห้องอย่างน้อยหนึ่งประเภท */
  valid: boolean;
  message: string | null;
}

export interface WebsiteBookedRoom {
  reference: string;
  roomType: { key: string; name: LocalizedText };
  adults: number;
  children: number;
  /** depositDue = ส่วนของห้องนี้ในยอดที่โอนตอนจอง */
  quote: StayQuote;
}

/**
 * ห้องเดียว: ฟิลด์ด้านบนคือห้องนั้น; หลายห้อง: reference/roomType/quote เป็นของห้องแรก,
 * adults/children เป็นยอดรวม และรายละเอียดทุกห้องอยู่ใน rooms + ยอดรวมใน total
 */
export interface WebsiteBookingResult {
  reference: string;
  status: string;
  roomType: { key: string; name: LocalizedText };
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  adults: number;
  children: number;
  guestName: string;
  email: string | null;
  quote: StayQuote;
  rooms: WebsiteBookedRoom[];
  total: { grandTotal: number; depositDue: number | null };
  /** null = ชำระที่โรงแรม */
  payment: WebsitePromptPayInfo | null;
}

interface RoomRequest {
  key: string;
  adults: number;
  children: number;
}

interface StayContext {
  site: WebsiteSite;
  property: NonNullable<Awaited<ReturnType<WebsiteBookingService['loadProperty']>>>;
  content: SiteContent;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  /** วันหยุดของโรงแรม (วันหยุดราชการที่เปิดไว้ + วันที่โรงแรมเพิ่มเอง) */
  holidayDates: string[];
  /** โค้ดที่แขกพิมพ์ (ตัวพิมพ์ใหญ่) */
  promoCode: string | null;
  /** โค้ดที่ใช้ได้ ณ ตอนนี้ (null = ไม่ได้ใส่ หรือใช้ไม่ได้ → ดู promoError) */
  promo: PromoRule | null;
  promoError: string | null;
}

interface TypeGroup {
  free: number;
  /** ห้องว่างที่จุคนได้มากสุด (สำหรับบอกขีดจำกัดจำนวนแขก) */
  roomiest: Room | null;
  /** promoError = เหตุที่ห้องนี้ใช้โค้ดไม่ได้ (เช่นคืนไม่ถึงขั้นต่ำ) */
  fitting: Array<{ room: Room; quote: BookingPricingSummary; promoError: string | null }>;
}

/**
 * แขกจองห้องเองจากหน้าเว็บโรงแรม (<slug>.staysync.io)
 *
 * - server เลือกห้อง (ถูกสุดที่ว่างในประเภทนั้น) และคิดราคาเองทั้งหมด — client ส่งได้แค่วัน/จำนวนแขก/ประเภทห้อง
 * - สร้างผ่าน BookingsService.create() ตัวเดียวกับพนักงาน → ได้ invoice / อีเมลยืนยัน / audit log เหมือนกัน
 * - กันจองชนกันด้วย MySQL named lock ต่อ property (ใช้ได้แม้รันหลาย ECS task)
 * - หน้า public ไม่มี tenant context → ทุก query กรอง tenantId/propertyId เอง
 */
@Injectable()
export class WebsiteBookingService {
  private readonly logger = new Logger(WebsiteBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicSites: WebsitePublicService,
    private readonly entitlement: WebsiteEntitlementService,
    private readonly bookings: BookingsService,
    private readonly payments: WebsitePaymentService,
    private readonly holidays: PropertyHolidaysService,
    private readonly promoCodes: PropertyPromoCodesService,
  ) {}

  async getAvailability(
    slug: string,
    query: WebsiteAvailabilityQueryDto,
  ): Promise<WebsiteAvailability> {
    const ctx = await this.loadContext(slug, query);
    const [groups, account, depositPolicy] = await Promise.all([
      this.groupBookableRooms(ctx),
      this.payments.findPromptPayAccount(ctx.property.id),
      this.payments.findDepositPolicy(ctx.property.id),
    ]);
    const deposit = account ? depositPolicy : null;

    const roomTypes = Array.from(groups.entries()).map(([key, g]): RoomTypeAvailability => {
      const best = this.cheapest(g);
      return {
        key,
        available: g.fitting.length,
        reason: g.fitting.length ? null : g.free ? 'CAPACITY' : 'FULL',
        quote: best ? this.toQuote(best.quote, deposit) : null,
        capacity: this.toCapacity(best?.room ?? g.roomiest),
      };
    });
    const promoApplied = roomTypes.some((t) => t.quote?.discount);

    return {
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      nights: this.nightsBetween(ctx.checkIn, ctx.checkOut),
      adults: ctx.adults,
      children: ctx.children,
      roomTypes,
      promo: ctx.promoCode
        ? {
            code: ctx.promoCode,
            valid: promoApplied,
            message: promoApplied ? null : (ctx.promoError ?? this.firstPromoError(groups)),
          }
        : null,
      payment: {
        promptpay: Boolean(account),
        accountName: account?.accountName ?? null,
        deposit,
      },
    };
  }

  async createBooking(
    slug: string,
    dto: CreateWebsiteBookingDto,
    ipAddress: string | null,
  ): Promise<WebsiteBookingResult> {
    // honeypot: คนจริงมองไม่เห็นช่องนี้
    if (dto.website && dto.website.trim()) {
      throw new BadRequestException('ไม่สามารถทำรายการได้');
    }

    const ctx = await this.loadContext(slug, dto);
    // แขกใส่โค้ดมา แต่ใช้ไม่ได้ → แจ้งก่อนจอง อย่าจองเต็มราคาเงียบ ๆ
    if (ctx.promoError) throw new BadRequestException(ctx.promoError);
    const requests = this.roomRequests(dto, ctx);
    const payOnline = dto.paymentMethod === 'PROMPTPAY';
    const account = payOnline ? await this.payments.findPromptPayAccount(ctx.property.id) : null;
    if (payOnline && !account) {
      throw new BadRequestException(
        'โรงแรมยังไม่เปิดรับชำระผ่าน PromptPay กรุณาเลือกชำระที่โรงแรม',
      );
    }
    const depositPolicy = account ? await this.payments.findDepositPolicy(ctx.property.id) : null;

    const created = await this.withPropertyLock(ctx.property.id, async () => {
      // เลือกห้องให้ครบทุกห้องก่อนสร้างการจองใด ๆ — ห้องไม่พอ = ไม่จองเลยสักห้อง
      const picks = await this.pickRooms(ctx, requests);
      const multi = picks.length > 1;

      const firstName = dto.firstName.trim();
      const lastName = dto.lastName.trim();
      const email = dto.email?.trim().toLowerCase() || null;
      const phone = dto.phone.trim();
      const note = dto.note?.trim() || '';
      const guestId = await this.upsertGuest(ctx.site.tenantId, {
        firstName,
        lastName,
        email,
        phone,
        ipAddress,
      });

      // มัดจำคิดจากยอดรวมทั้งชุด (มัดจำแบบคงที่ = ต่อการจองหนึ่งครั้ง ไม่ใช่ต่อห้อง)
      // แล้วแบ่งลงแต่ละห้องตามสัดส่วน ให้พนักงานเห็นใน notes ของแต่ละห้องตั้งแต่แรก
      const expectedTotals = picks.map((p) => p.best.quote.grandTotal);
      const expectedDeposit = depositPolicy
        ? depositDue(
            depositPolicy,
            expectedTotals.reduce((a, b) => a + b, 0),
          )
        : null;
      const expectedShares = allocateDue(expectedDeposit, expectedTotals);
      const groupId = multi ? randomUUID() : null;

      const bookings: Array<{
        id: string;
        status: string;
        reference: string;
        pricing: BookingPricingSummary;
      }> = [];
      try {
        for (const [i, pick] of picks.entries()) {
          // ตรวจโควตาซ้ำใน lock ทุกห้อง — การจองจากเว็บของ property นี้เรียงคิวกันอยู่ จึงนับได้ตรง
          const promo = ctx.promo
            ? await this.promoCodes.findRedeemable(
                ctx.property.id,
                ctx.site.tenantId,
                ctx.promo.code,
              )
            : undefined;
          const booking = await this.bookings.create(
            {
              propertyId: ctx.property.id,
              roomId: pick.best.room.id,
              guestId,
              guestFirstName: firstName,
              guestLastName: lastName,
              guestEmail: email ?? undefined,
              guestPhone: phone,
              checkIn: ctx.checkIn,
              checkOut: ctx.checkOut,
              adults: pick.adults,
              children: pick.children,
              notes: [
                'จองผ่านเว็บไซต์โรงแรม',
                multi
                  ? `จองพร้อมกัน ${picks.length} ห้อง (ห้องที่ ${i + 1}) — ชำระ QR ใบเดียว`
                  : null,
                expectedDeposit != null
                  ? `มัดจำ PromptPay ฿${expectedShares[i].toLocaleString('en-US')} — ส่วนที่เหลือชำระที่โรงแรม`
                  : null,
                note,
              ]
                .filter(Boolean)
                .join('\n'),
              source: 'WEBSITE',
              paymentMethod: payOnline ? 'PROMPTPAY' : 'PAY_AT_HOTEL',
              holidayDates: ctx.holidayDates,
            } as unknown as CreateBookingDto,
            ctx.site.tenantId,
            { promo },
          );
          if (groupId) {
            await this.prisma.booking.updateMany({
              where: { id: booking.id, tenantId: ctx.site.tenantId },
              data: { bookingGroupId: groupId },
            });
          }
          bookings.push({
            id: booking.id,
            status: String(booking.status ?? 'pending'),
            reference: String(booking.bookingNumber ?? booking.id.slice(0, 8)).toUpperCase(),
            // ยอดที่บันทึกจริงในการจอง (คิดใหม่ตอนสร้าง) — ตรงกับใบแจ้งหนี้/QR
            pricing: (booking.pricingBreakdown as BookingPricingSummary | null) ?? pick.best.quote,
          });
        }
      } catch (err) {
        await this.cancelPartialGroup(
          bookings.map((b) => b.id),
          ctx.site.tenantId,
        );
        throw err;
      }

      const totals = bookings.map((b) => b.pricing.grandTotal);
      const grandTotal = Math.round(totals.reduce((a, b) => a + b, 0) * 100) / 100;
      const deposit = depositPolicy ? depositDue(depositPolicy, grandTotal) : null;
      const shares = allocateDue(deposit, totals);
      const rooms: WebsiteBookedRoom[] = picks.map((pick, i) => ({
        reference: bookings[i].reference,
        roomType: { key: pick.key, name: this.roomTypeName(ctx.content, pick.key) },
        adults: pick.adults,
        children: pick.children,
        quote: {
          ...this.toQuote(bookings[i].pricing),
          depositDue: deposit != null ? shares[i] : null,
        },
      }));
      const lead = bookings[0];

      // บันทึกไว้ในกล่องข้อความของเว็บด้วย (ผูกกับ booking ห้องแรก) ให้พนักงานเห็นที่มาของการจอง
      await this.prisma.websiteInquiry
        .create({
          data: {
            tenantId: ctx.site.tenantId,
            siteId: ctx.site.id,
            type: 'BOOKING_REQUEST',
            status: 'CONVERTED',
            bookingId: lead.id,
            name: `${firstName} ${lastName}`,
            phone,
            email,
            message:
              [
                multi
                  ? `จอง ${rooms.length} ห้อง: ${rooms.map((r) => `#${r.reference}`).join(', ')}`
                  : '',
                note,
              ]
                .filter(Boolean)
                .join('\n') || null,
            checkIn: new Date(`${ctx.checkIn}T00:00:00.000Z`),
            checkOut: new Date(`${ctx.checkOut}T00:00:00.000Z`),
            adults: picks.reduce((n, p) => n + p.adults, 0),
            children: picks.reduce((n, p) => n + p.children, 0),
            roomType: picks[0].key,
          },
        })
        .catch((err: Error) =>
          this.logger.error(`inquiry record failed for booking ${lead.id}: ${err.message}`),
        );

      const what = multi
        ? `${rooms.length} ห้อง (${rooms.map((r) => `${r.roomType.name.th} #${r.reference}`).join(', ')})`
        : `${rooms[0].roomType.name.th}`;
      await this.publicSites.notifyStaff(ctx.site.tenantId, {
        refId: lead.id,
        title: multi ? `การจองใหม่จากเว็บไซต์ ${rooms.length} ห้อง` : 'การจองใหม่จากเว็บไซต์',
        message: `${firstName} ${lastName} จอง ${what} ${ctx.checkIn} – ${ctx.checkOut}${multi ? '' : ` (#${lead.reference})`} ${
          !payOnline
            ? 'ชำระที่โรงแรม — รอยืนยัน'
            : deposit != null
              ? `เลือกโอนมัดจำ PromptPay ฿${deposit.toLocaleString('en-US')} — รอแขกแนบสลิป`
              : `เลือกโอน PromptPay${multi ? ` ฿${grandTotal.toLocaleString('en-US')}` : ''} — รอแขกแนบสลิป`
        }`,
      });

      const result: WebsiteBookingResult = {
        reference: lead.reference,
        status: lead.status,
        roomType: rooms[0].roomType,
        checkIn: ctx.checkIn,
        checkOut: ctx.checkOut,
        checkInTime: ctx.property.standardCheckInTime ?? DEFAULT_CHECK_IN_TIME,
        checkOutTime: ctx.property.standardCheckOutTime ?? DEFAULT_CHECK_OUT_TIME,
        adults: picks.reduce((n, p) => n + p.adults, 0),
        children: picks.reduce((n, p) => n + p.children, 0),
        guestName: `${firstName} ${lastName}`,
        email,
        quote: rooms[0].quote,
        rooms,
        total: { grandTotal, depositDue: deposit },
        payment: null,
      };
      return {
        result,
        shares: bookings.map((b, i) => ({ bookingId: b.id, amount: shares[i] })),
      };
    });

    if (!account) return created.result;
    // สร้าง QR นอก lock — booking สถานะ pending กันห้องไว้แล้ว ถ้าสร้าง QR ไม่ได้แขกยังได้เลขจอง
    // และโรงแรมเห็นการจองเพื่อติดต่อเรื่องชำระเงินได้
    try {
      const payment = await this.payments.createPromptPayCharge({
        tenantId: ctx.site.tenantId,
        shares: created.shares,
        grandTotal: created.result.total.grandTotal,
        account,
      });
      return { ...created.result, payment };
    } catch (err) {
      this.logger.error(
        `PromptPay QR failed for booking ${created.shares[0].bookingId}: ${(err as Error).message}`,
      );
      return created.result;
    }
  }

  // ─── internals ───────────────────────────────────────────────────────

  private loadProperty(site: WebsiteSite) {
    return this.prisma.property.findFirst({
      where: { id: site.propertyId, tenantId: site.tenantId, deletedAt: null },
    });
  }

  private async loadContext(
    slug: string,
    query: WebsiteAvailabilityQueryDto,
  ): Promise<StayContext> {
    const site = await this.publicSites.findPublishedSite(slug);
    if (!(await this.entitlement.isLive(site.tenantId))) {
      throw new NotFoundException('Website not found');
    }
    this.publicSites.assertStayDates(query.checkIn, query.checkOut);

    const property = await this.loadProperty(site);
    if (!property) throw new NotFoundException('Website not found');

    const promoCode = query.promoCode?.trim().toUpperCase() || null;
    let promo: PromoRule | null = null;
    let promoError: string | null = null;
    if (promoCode) {
      try {
        promo = await this.promoCodes.findRedeemable(property.id, site.tenantId, promoCode);
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
        promoError = err.message;
      }
    }

    return {
      site,
      property,
      content: sanitizeSiteContent(site.publishedContent, property.name),
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      adults: query.adults ?? 2,
      children: query.children ?? 0,
      holidayDates: await this.holidays.resolveDates(site.propertyId, site.tenantId),
      promoCode,
      promo,
      promoError,
    };
  }

  /**
   * ห้องที่ว่างช่วงนั้น จัดกลุ่มตาม Room.type (ซ่อนประเภทที่เจ้าของปิดไว้ในเว็บ)
   * เงื่อนไขชนกันเหมือน BookingsService.create(): เวลาเข้า/ออกมาตรฐานของ property + cleaning buffer
   */
  private async groupBookableRooms(
    ctx: StayContext,
    onlyType?: string,
  ): Promise<Map<string, TypeGroup>> {
    const { site, property } = ctx;
    const rooms = await this.prisma.room.findMany({
      where: {
        tenantId: site.tenantId,
        propertyId: property.id,
        status: { notIn: [...UNBOOKABLE_ROOM_STATUSES] },
      },
    });
    const candidates = rooms.filter((r) => {
      const key = r.type.trim();
      if (!key || ctx.content.roomTypes[key]?.hidden) return false;
      return onlyType === undefined || key === onlyType;
    });

    const blocked = await this.blockedRoomIds(
      ctx,
      candidates.map((r) => r.id),
    );
    const groups = new Map<string, TypeGroup>();
    for (const room of candidates) {
      const key = room.type.trim();
      const group = groups.get(key) ?? { free: 0, roomiest: null, fitting: [] };
      groups.set(key, group);
      if (blocked.has(room.id)) continue;
      group.free += 1;
      if (!group.roomiest || this.totalCapacity(room) > this.totalCapacity(group.roomiest)) {
        group.roomiest = room;
      }
      if (!this.bookings.fitsOccupancy(room, ctx.adults, ctx.children)) continue;
      const quote = (promo?: PromoRule) =>
        this.bookings.quoteStay(
          room,
          property,
          ctx.checkIn,
          ctx.checkOut,
          ctx.holidayDates,
          { adults: ctx.adults, children: ctx.children },
          promo,
        );
      const full = quote();
      const promoError = ctx.promo
        ? promoStayIneligibility(ctx.promo, {
            nights: full.nightlyRates.length,
            grossSubtotal: full.roomSubtotal,
          })
        : null;
      group.fitting.push({
        room,
        quote: ctx.promo && !promoError ? quote(ctx.promo) : full,
        promoError,
      });
    }
    return groups;
  }

  private async blockedRoomIds(ctx: StayContext, roomIds: string[]): Promise<Set<string>> {
    if (!roomIds.length) return new Set();
    const { property } = ctx;
    const scheduledIn = buildBangkokDateTime(
      ctx.checkIn,
      resolveTimeWithFallback(undefined, property.standardCheckInTime, DEFAULT_CHECK_IN_TIME),
    );
    const scheduledOut = buildBangkokDateTime(
      ctx.checkOut,
      resolveTimeWithFallback(undefined, property.standardCheckOutTime, DEFAULT_CHECK_OUT_TIME),
    );
    const { overlapStart, overlapEnd } = applyCleaningBuffer(
      scheduledIn,
      scheduledOut,
      property.cleaningBufferMinutes ?? DEFAULT_CLEANING_BUFFER_MINUTES,
    );

    const rows = await this.prisma.booking.findMany({
      where: {
        tenantId: ctx.site.tenantId,
        roomId: { in: roomIds },
        status: { in: BLOCKING_STATUSES },
        OR: [
          { scheduledCheckIn: { lt: overlapEnd }, scheduledCheckOut: { gt: overlapStart } },
          // booking เก่าที่ไม่มี scheduledCheckIn
          { scheduledCheckIn: null, checkIn: { lt: overlapEnd }, checkOut: { gt: overlapStart } },
        ],
      },
      select: { roomId: true },
    });
    return new Set(rows.map((r) => r.roomId));
  }

  /** ห้องที่แขกขอ — rooms[] (หลายห้อง) หรือ roomType + จำนวนแขกด้านบน (ห้องเดียว) */
  private roomRequests(dto: CreateWebsiteBookingDto, ctx: StayContext): RoomRequest[] {
    const requests: RoomRequest[] = dto.rooms?.length
      ? dto.rooms.map((r) => ({ key: r.roomType.trim(), adults: r.adults, children: r.children }))
      : [{ key: dto.roomType?.trim() ?? '', adults: ctx.adults, children: ctx.children }];
    if (requests.some((r) => !r.key)) throw new BadRequestException('กรุณาเลือกประเภทห้อง');
    return requests;
  }

  /** ห้องว่างที่ถูกสุดของแต่ละคำขอ โดยไม่ซ้ำห้องกัน (เรียกใน lock เท่านั้น) */
  private async pickRooms(
    ctx: StayContext,
    requests: RoomRequest[],
  ): Promise<Array<RoomRequest & { best: TypeGroup['fitting'][number] }>> {
    const taken = new Set<string>();
    const picks: Array<RoomRequest & { best: TypeGroup['fitting'][number] }> = [];
    for (const req of requests) {
      const group = (
        await this.groupBookableRooms(
          { ...ctx, adults: req.adults, children: req.children },
          req.key,
        )
      ).get(req.key);
      const best =
        group &&
        this.cheapest({ ...group, fitting: group.fitting.filter((f) => !taken.has(f.room.id)) });
      if (!best) {
        const name = this.roomTypeName(ctx.content, req.key).th;
        throw new ConflictException(
          group?.fitting.length
            ? `${name} ว่างไม่พอสำหรับจำนวนห้องที่เลือก กรุณาลดจำนวนห้องหรือเลือกห้องอื่น`
            : group?.free
              ? requests.length > 1
                ? `${name} รับผู้เข้าพัก ${req.adults} ผู้ใหญ่${req.children ? ` ${req.children} เด็ก` : ''} ไม่ได้ กรุณาปรับจำนวนแขกต่อห้อง`
                : 'ห้องประเภทนี้รับจำนวนผู้เข้าพักที่เลือกไม่ได้ กรุณาเลือกห้องอื่น'
              : 'ห้องประเภทนี้เต็มแล้วสำหรับวันที่เลือก กรุณาเลือกวันหรือห้องอื่น',
        );
      }
      if (best.promoError) throw new BadRequestException(best.promoError);
      taken.add(best.room.id);
      picks.push({ ...req, best });
    }
    return picks;
  }

  /** สร้างการจองหลายห้องไม่ครบ → ยกเลิกห้องที่สร้างไปแล้ว ไม่ให้แขกค้างจองครึ่งชุด */
  private async cancelPartialGroup(bookingIds: string[], tenantId: string): Promise<void> {
    for (const id of bookingIds) {
      await this.bookings
        .update(id, { status: 'cancelled' }, tenantId)
        .catch((err: Error) =>
          this.logger.error(`rollback of partial website booking ${id} failed: ${err.message}`),
        );
    }
  }

  private cheapest(group: TypeGroup): TypeGroup['fitting'][number] | null {
    return group.fitting.reduce<TypeGroup['fitting'][number] | null>(
      (best, cur) => (!best || cur.quote.grandTotal < best.quote.grandTotal ? cur : best),
      null,
    );
  }

  private firstPromoError(groups: Map<string, TypeGroup>): string | null {
    for (const g of groups.values()) {
      const err = this.cheapest(g)?.promoError;
      if (err) return err;
    }
    return null;
  }

  /**
   * จับคู่แขกเดิมด้วยอีเมลก่อน แล้วค่อยเบอร์โทร (ไม่แก้ชื่อ/ข้อมูลของ profile เดิม)
   * ไม่เจอ → สร้างใหม่พร้อมบันทึกความยินยอม PDPA
   */
  private async upsertGuest(
    tenantId: string,
    g: {
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string;
      ipAddress: string | null;
    },
  ): Promise<string> {
    const consent = {
      consentGiven: true,
      consentAt: new Date(),
      consentVersion: CONSENT_VERSION,
      consentIpAddress: g.ipAddress?.slice(0, 45) ?? null,
    };
    const scope = { tenantId, anonymizedAt: null };
    const existing =
      (g.email
        ? await this.prisma.guest.findFirst({
            where: { ...scope, email: g.email },
            select: { id: true, consentGiven: true },
          })
        : null) ??
      (await this.prisma.guest.findFirst({
        where: { ...scope, phone: g.phone },
        select: { id: true, consentGiven: true },
      }));

    if (existing) {
      if (!existing.consentGiven) {
        await this.prisma.guest.updateMany({ where: { id: existing.id, tenantId }, data: consent });
      }
      return existing.id;
    }

    const created = await this.prisma.guest.create({
      data: {
        tenantId,
        firstName: g.firstName,
        lastName: g.lastName,
        email: g.email,
        phone: g.phone,
        ...consent,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * MySQL GET_LOCK ผูกกับ connection — ต้องถือ connection เดียวไว้ตลอดด้วย interactive transaction
   * งานข้างในใช้ this.prisma (connection อื่น) ได้ตามปกติ lock มีไว้เรียงคิวการจองจากเว็บต่อ property
   */
  private async withPropertyLock<T>(propertyId: string, work: () => Promise<T>): Promise<T> {
    const name = `wb-book:${propertyId}`;
    return this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ ok: number | bigint | null }>>`
          SELECT GET_LOCK(${name}, ${BOOKING_LOCK_WAIT_SECONDS}) AS ok`;
        if (Number(row?.ok) !== 1) {
          throw new ServiceUnavailableException('มีผู้จองพร้อมกันจำนวนมาก กรุณาลองใหม่อีกครั้ง');
        }
        try {
          return await work();
        } finally {
          await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
        }
      },
      { maxWait: 5_000, timeout: (BOOKING_LOCK_WAIT_SECONDS + 20) * 1_000 },
    );
  }

  private roomTypeName(content: SiteContent, key: string): LocalizedText {
    const name = content.roomTypes[key]?.displayName;
    return { th: name?.th || key, en: name?.en || name?.th || key };
  }

  private nightsBetween(checkIn: string, checkOut: string): number {
    return Math.round(
      (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000,
    );
  }

  private totalCapacity(room: Room): number {
    return (room.maxOccupancy ?? 0) + (room.extraBedAllowed ? room.extraBedLimit : 0);
  }

  private toCapacity(room: Room | null): RoomCapacity | null {
    if (!room) return null;
    return {
      maxOccupancy: room.maxOccupancy ?? 0,
      extraBedLimit: room.extraBedAllowed ? room.extraBedLimit : 0,
      extraBedPrice: Number(room.extraBedPrice ?? 0),
      childFree: room.childNoExtraCharge,
      childFreeNote: room.childNoExtraChargeNote?.trim() || null,
    };
  }

  private toQuote(p: BookingPricingSummary, deposit: DepositPolicy | null = null): StayQuote {
    return {
      nights: p.nightlyRates.length,
      nightlyRates: p.nightlyRates.map((n) => ({
        date: n.date,
        rate: n.appliedRate,
        label: n.pricingLabel,
        type: n.pricingType,
      })),
      roomSubtotal: p.roomSubtotal,
      discount: p.promo
        ? {
            code: p.promo.code,
            amount: p.promo.amount,
            subtotalBeforeDiscount: p.promo.grossSubtotal,
          }
        : null,
      extraBeds: p.extraBeds ?? null,
      serviceChargePercent: p.serviceChargePercent,
      serviceChargeAmount: p.serviceChargeAmount,
      vatPercent: p.vatPercent,
      vatAmount: p.vatAmount,
      grandTotal: p.grandTotal,
      depositDue: deposit ? depositDue(deposit, p.grandTotal) : null,
      currency: 'THB',
    };
  }
}
