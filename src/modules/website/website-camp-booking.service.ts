import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WebsiteSite } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { ReservationsService } from '../camp/reservations.service';
import { quoteCampStay } from '../camp/camp-pricing';
import { WebsiteEntitlementService } from './website-entitlement.service';
import { WebsitePublicService } from './website-public.service';
import { UNSELLABLE_PITCH_STATUSES, WebsiteCampPublicService } from './website-camp-public.service';
import { WebsitePaymentService, WebsitePromptPayInfo } from './website-payment.service';
import { DepositPolicy, depositDue } from './website-deposit';
import { LocalizedText, sanitizeSiteContent } from './website-content';
import { CampAvailabilityQueryDto, CreateCampBookingDto } from './dto/website-camp-booking.dto';

/** สถานะที่กันจุด — ต้องตรงกับ ReservationsService (BLOCKING_STATUSES) */
const BLOCKING_STATUSES = ['pending', 'confirmed', 'checked_in'];
const BOOKING_LOCK_WAIT_SECONDS = 10;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface CampQuote {
  nights: number;
  /** ค่าลาน (คูณจำนวนคนแล้วถ้าโซนคิดต่อคน) */
  lodging: number;
  electricity: number;
  /** ค่าเช่าอุปกรณ์ (เฉพาะตอนจอง — availability ยังไม่รวม) */
  equipment: number;
  grandTotal: number;
  /** มัดจำที่ต้องโอน PromptPay ตอนจอง — null = โอนเต็มจำนวน (หรือลานไม่รับ PromptPay) */
  depositDue: number | null;
  currency: 'THB';
}

export interface CampZoneAvailability {
  key: string;
  /** จำนวนจุดว่างของโซนในช่วงนั้น */
  available: number;
  /** FULL = จุดเต็ม, CAPACITY = คน/เต็นท์เกินโซน, RULES = โซนไม่รับรถ/สัตว์เลี้ยง */
  reason: 'FULL' | 'CAPACITY' | 'RULES' | null;
  message: string | null;
  quote: CampQuote | null;
}

export interface CampAvailability {
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  tents: number;
  vehicles: number;
  pet: boolean;
  zones: CampZoneAvailability[];
  payment: { promptpay: boolean; accountName: string | null; deposit: DepositPolicy | null };
}

export interface CampBookingResult {
  reference: string;
  status: string;
  zone: { key: string; name: LocalizedText };
  checkIn: string;
  checkOut: string;
  checkInTime: string;
  checkOutTime: string;
  guests: number;
  tents: number;
  vehicles: number;
  pet: boolean;
  guestName: string;
  email: string | null;
  equipment: Array<{ name: string; qty: number; unitPrice: number; amount: number }>;
  quote: CampQuote;
  /** null = ชำระที่ลาน */
  payment: WebsitePromptPayInfo | null;
}

interface Party {
  guests: number;
  tents: number;
  vehicles: number;
  pet: boolean;
}

type ZoneRow = Awaited<ReturnType<WebsiteCampBookingService['loadZones']>>[number];

interface CampContext {
  site: WebsiteSite;
  campground: Awaited<ReturnType<WebsiteCampPublicService['findCampground']>>;
  checkIn: string;
  checkOut: string;
  party: Party;
}

/**
 * แขกจองลานกางเต็นท์เองจากหน้าเว็บ (<slug>.staysync.io ที่ผูกกับ campground)
 *
 * - server เลือกจุดว่างในโซนเอง + คิดราคาด้วย quoteCampStay (สูตรเดียวกับพนักงาน)
 * - สร้างผ่าน ReservationsService.create() ตัวเดียวกับพนักงาน (source = WEBSITE)
 *   ซึ่งไม่ตรวจสถานะจุด/ความจุโซน → service นี้ตรวจเองก่อนเรียก
 * - กันจองชนกันด้วย MySQL named lock ต่อ campground
 * - หน้า public ไม่มี tenant context → ทุก query กรอง tenantId/campgroundId เอง
 */
@Injectable()
export class WebsiteCampBookingService {
  private readonly logger = new Logger(WebsiteCampBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicSites: WebsitePublicService,
    private readonly campPublic: WebsiteCampPublicService,
    private readonly entitlement: WebsiteEntitlementService,
    private readonly reservations: ReservationsService,
    private readonly payments: WebsitePaymentService,
  ) {}

  async getAvailability(slug: string, query: CampAvailabilityQueryDto): Promise<CampAvailability> {
    const ctx = await this.loadContext(slug, query);
    const [zones, account, depositPolicy] = await Promise.all([
      this.loadZones(ctx),
      this.payments.findPromptPayAccount(ctx.site.propertyId),
      this.payments.findDepositPolicy(ctx.site.propertyId),
    ]);
    const deposit = account ? depositPolicy : null;
    const content = sanitizeSiteContent(ctx.site.publishedContent, ctx.campground.name, 'camp');
    const blocked = await this.blockedPitchIds(
      ctx,
      zones.flatMap((z) => z.pitches.map((p) => p.id)),
    );

    const result = zones
      .filter((z) => z.pitches.length && !content.roomTypes[z.id]?.hidden)
      .map((zone): CampZoneAvailability => {
        const free = zone.pitches.filter((p) => !blocked.has(p.id)).length;
        const rule = this.ruleViolation(zone, ctx.party);
        const quote = this.quote(zone, ctx, 0, deposit);
        if (!free) return { key: zone.id, available: 0, reason: 'FULL', message: null, quote };
        if (rule) return { key: zone.id, available: free, ...rule, quote };
        return { key: zone.id, available: free, reason: null, message: null, quote };
      });

    return {
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      nights: this.nightsBetween(ctx.checkIn, ctx.checkOut),
      ...ctx.party,
      zones: result,
      payment: { promptpay: Boolean(account), accountName: account?.accountName ?? null, deposit },
    };
  }

  async createBooking(slug: string, dto: CreateCampBookingDto): Promise<CampBookingResult> {
    // honeypot: คนจริงมองไม่เห็นช่องนี้
    if (dto.website && dto.website.trim()) {
      throw new BadRequestException('ไม่สามารถทำรายการได้');
    }
    const ctx = await this.loadContext(slug, dto);
    const content = sanitizeSiteContent(ctx.site.publishedContent, ctx.campground.name, 'camp');
    if (content.roomTypes[dto.zoneKey]?.hidden) throw new NotFoundException('ไม่พบโซนนี้');

    const payOnline = dto.paymentMethod === 'PROMPTPAY';
    const account = payOnline
      ? await this.payments.findPromptPayAccount(ctx.site.propertyId)
      : null;
    if (payOnline && !account) {
      throw new BadRequestException('ลานยังไม่เปิดรับชำระผ่าน PromptPay กรุณาเลือกชำระที่ลาน');
    }
    const depositPolicy = account
      ? await this.payments.findDepositPolicy(ctx.site.propertyId)
      : null;
    const equipment = await this.resolveEquipment(ctx, dto.equipment ?? []);

    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const email = dto.email?.trim().toLowerCase() || null;
    const phone = dto.phone.trim();
    const note = dto.note?.trim() || '';

    const created = await this.withCampgroundLock(ctx.campground.id, async () => {
      const [zone] = await this.loadZones(ctx, dto.zoneKey);
      if (!zone || !zone.pitches.length) throw new NotFoundException('ไม่พบโซนนี้');
      const rule = this.ruleViolation(zone, ctx.party);
      if (rule) throw new BadRequestException(rule.message);

      // จุดว่างจุดแรกตามรหัสจุด — ตรวจซ้ำใน lock เพราะการจองจากเว็บของลานนี้เรียงคิวกันอยู่
      const blocked = await this.blockedPitchIds(
        ctx,
        zone.pitches.map((p) => p.id),
      );
      const pitch = zone.pitches.find((p) => !blocked.has(p.id));
      if (!pitch)
        throw new ConflictException('โซนนี้เต็มแล้วในวันที่เลือก กรุณาเลือกโซนหรือวันอื่น');

      const res = await this.reservations.create(
        {
          campgroundId: ctx.campground.id,
          zoneId: zone.id,
          pitchId: pitch.id,
          guestFirstName: firstName,
          guestLastName: lastName,
          guestEmail: email ?? undefined,
          guestPhone: phone,
          checkIn: new Date(`${ctx.checkIn}T00:00:00.000Z`).toISOString(),
          checkOut: new Date(`${ctx.checkOut}T00:00:00.000Z`).toISOString(),
          numGuests: ctx.party.guests,
          numTents: ctx.party.tents,
          numVehicles: ctx.party.vehicles,
          hasPet: ctx.party.pet,
          addons: equipment.map((e) => ({ addonId: e.addonId, qty: e.qty })),
          notes: ['จองผ่านเว็บไซต์', note].filter(Boolean).join(' — '),
        },
        ctx.site.tenantId,
        { source: 'WEBSITE' },
      );
      return { reservation: res.data, zone };
    });

    const { reservation, zone } = created;
    const equipmentTotal = round2(equipment.reduce((sum, e) => sum + e.amount, 0));
    // ยอดที่บันทึกจริงในใบจอง (คิดใหม่ใน ReservationsService) — ตรงกับที่พนักงานเห็น
    const grandTotal = round2(Number(reservation.totalPrice));
    const deposit = depositPolicy ? depositDue(depositPolicy, grandTotal) : null;
    const stay = this.quote(zone, ctx, equipmentTotal, null);
    const quote: CampQuote = { ...stay, grandTotal, depositDue: deposit };
    const reference = String(reservation.reservationNo ?? reservation.id.slice(0, 8)).toUpperCase();
    const zoneName = this.zoneName(content.roomTypes[zone.id]?.displayName, zone.name);
    const guestName = `${firstName} ${lastName}`;

    await this.prisma.websiteInquiry
      .create({
        data: {
          tenantId: ctx.site.tenantId,
          siteId: ctx.site.id,
          type: 'BOOKING_REQUEST',
          status: 'CONVERTED',
          name: guestName,
          phone,
          email,
          message: [`การจองลาน #${reference}`, note].filter(Boolean).join('\n'),
          checkIn: new Date(`${ctx.checkIn}T00:00:00.000Z`),
          checkOut: new Date(`${ctx.checkOut}T00:00:00.000Z`),
          adults: ctx.party.guests,
          children: 0,
          roomType: zone.name,
        },
      })
      .catch((err: Error) =>
        this.logger.error(
          `inquiry record failed for camp reservation ${reservation.id}: ${err.message}`,
        ),
      );

    await this.publicSites.notifyStaff(ctx.site.tenantId, {
      refId: reservation.id,
      title: 'การจองลานใหม่จากเว็บไซต์',
      message: `${guestName} จองโซน ${zone.name} ${ctx.checkIn} – ${ctx.checkOut} (#${reference}) ${
        !payOnline
          ? 'ชำระที่ลาน — รอยืนยัน'
          : deposit != null
            ? `เลือกโอนมัดจำ PromptPay ฿${deposit.toLocaleString('en-US')} — รอแขกแนบสลิป`
            : `เลือกโอน PromptPay ฿${grandTotal.toLocaleString('en-US')} — รอแขกแนบสลิป`
      }`,
    });

    const result: CampBookingResult = {
      reference,
      status: reservation.status,
      zone: { key: zone.id, name: zoneName },
      checkIn: ctx.checkIn,
      checkOut: ctx.checkOut,
      checkInTime: ctx.campground.checkInTime ?? '14:00',
      checkOutTime: ctx.campground.checkOutTime ?? '12:00',
      ...ctx.party,
      guestName,
      email,
      equipment: equipment.map(({ name, qty, unitPrice, amount }) => ({
        name,
        qty,
        unitPrice,
        amount,
      })),
      quote,
      payment: null,
    };
    if (!account || grandTotal <= 0) return result;

    // สร้าง QR นอก lock — การจอง pending กันจุดไว้แล้ว ถ้าสร้าง QR ไม่ได้แขกยังได้เลขจอง
    try {
      const payment = await this.payments.createCampPromptPayCharge({
        tenantId: ctx.site.tenantId,
        reservationId: reservation.id,
        amount: deposit ?? grandTotal,
        grandTotal,
        account,
      });
      return { ...result, payment };
    } catch (err) {
      this.logger.error(
        `PromptPay QR failed for camp reservation ${reservation.id}: ${(err as Error).message}`,
      );
      return result;
    }
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async loadContext(slug: string, query: CampAvailabilityQueryDto): Promise<CampContext> {
    const site = await this.publicSites.findPublishedSite(slug);
    if (!site.campgroundId) throw new NotFoundException('Website not found');
    if (!(await this.entitlement.isLive(site.tenantId))) {
      throw new NotFoundException('Website not found');
    }
    this.publicSites.assertStayDates(query.checkIn, query.checkOut);
    const campground = await this.campPublic.findCampground(site);
    return {
      site,
      campground,
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      party: {
        guests: query.guests ?? 2,
        tents: query.tents ?? 1,
        vehicles: query.vehicles ?? 0,
        pet: query.pet ?? false,
      },
    };
  }

  /** โซนของลาน + จุดที่เปิดขาย (ไม่นับจุดปิด/ซ่อม) เรียงตามรหัสจุด */
  private loadZones(ctx: { site: WebsiteSite; campground: { id: string } }, zoneId?: string) {
    return this.prisma.campZone.findMany({
      where: {
        tenantId: ctx.site.tenantId,
        campgroundId: ctx.campground.id,
        ...(zoneId ? { id: zoneId } : {}),
      },
      select: {
        id: true,
        name: true,
        basePrice: true,
        weekendPrice: true,
        seasonalRates: true,
        pricingMode: true,
        hasElectricity: true,
        electricityFee: true,
        maxGuests: true,
        maxTents: true,
        allowVehicle: true,
        allowPet: true,
        pitches: {
          where: { status: { notIn: UNSELLABLE_PITCH_STATUSES } },
          select: { id: true },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: [{ basePrice: 'asc' }, { name: 'asc' }],
    });
  }

  private async blockedPitchIds(ctx: CampContext, pitchIds: string[]): Promise<Set<string>> {
    if (!pitchIds.length) return new Set();
    const rows = await this.prisma.campReservation.findMany({
      where: {
        tenantId: ctx.site.tenantId,
        pitchId: { in: pitchIds },
        status: { in: BLOCKING_STATUSES },
        checkIn: { lt: new Date(`${ctx.checkOut}T00:00:00.000Z`) },
        checkOut: { gt: new Date(`${ctx.checkIn}T00:00:00.000Z`) },
      },
      select: { pitchId: true },
    });
    return new Set(rows.map((r) => r.pitchId));
  }

  private ruleViolation(
    zone: ZoneRow,
    party: Party,
  ): { reason: 'CAPACITY' | 'RULES'; message: string } | null {
    if (party.guests > zone.maxGuests) {
      return { reason: 'CAPACITY', message: `โซนนี้รับได้สูงสุด ${zone.maxGuests} คนต่อจุด` };
    }
    if (party.tents > zone.maxTents) {
      return { reason: 'CAPACITY', message: `โซนนี้กางได้สูงสุด ${zone.maxTents} เต็นท์ต่อจุด` };
    }
    if (party.vehicles > 0 && !zone.allowVehicle) {
      return { reason: 'RULES', message: 'โซนนี้ไม่อนุญาตให้นำรถเข้าจุดกาง' };
    }
    if (party.pet && !zone.allowPet) {
      return { reason: 'RULES', message: 'โซนนี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้า' };
    }
    return null;
  }

  private quote(
    zone: ZoneRow,
    ctx: CampContext,
    equipment: number,
    deposit: DepositPolicy | null,
  ): CampQuote {
    const stay = quoteCampStay(
      zone,
      new Date(`${ctx.checkIn}T00:00:00.000Z`),
      new Date(`${ctx.checkOut}T00:00:00.000Z`),
      ctx.party.guests,
    );
    const grandTotal = round2(stay.lodging + stay.electricity + equipment);
    return {
      ...stay,
      equipment,
      grandTotal,
      depositDue: deposit ? depositDue(deposit, grandTotal) : null,
      currency: 'THB',
    };
  }

  /** อุปกรณ์ต้องเป็นของลานนี้และเปิดให้เช่า — ราคาจาก DB เสมอ (รวมรายการซ้ำเป็นบรรทัดเดียว) */
  private async resolveEquipment(
    ctx: CampContext,
    requested: Array<{ addonId: string; qty: number }>,
  ): Promise<
    Array<{ addonId: string; name: string; qty: number; unitPrice: number; amount: number }>
  > {
    if (!requested.length) return [];
    const qtyOf = new Map<string, number>();
    for (const r of requested) qtyOf.set(r.addonId, (qtyOf.get(r.addonId) ?? 0) + r.qty);
    const available = await this.campPublic.listEquipment(ctx.site.tenantId, ctx.campground.id);
    const byId = new Map(available.map((e) => [e.id, e]));
    return Array.from(qtyOf.entries()).map(([addonId, qty]) => {
      const item = byId.get(addonId);
      if (!item)
        throw new BadRequestException('มีอุปกรณ์ที่เลือกไม่พร้อมให้เช่าแล้ว กรุณาเลือกใหม่');
      return {
        addonId,
        name: item.name,
        qty,
        unitPrice: item.pricePerUnit,
        amount: round2(item.pricePerUnit * qty),
      };
    });
  }

  private zoneName(override: LocalizedText | undefined, fallback: string): LocalizedText {
    return { th: override?.th || fallback, en: override?.en || override?.th || fallback };
  }

  private nightsBetween(checkIn: string, checkOut: string): number {
    return Math.round(
      (new Date(`${checkOut}T00:00:00.000Z`).getTime() -
        new Date(`${checkIn}T00:00:00.000Z`).getTime()) /
        86_400_000,
    );
  }

  private async withCampgroundLock<T>(campgroundId: string, work: () => Promise<T>): Promise<T> {
    const name = `wb-camp:${campgroundId}`;
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
}
