import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WebsiteSite } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationsService } from '@/notifications/notifications.service';
import { WebsiteEntitlementService } from './website-entitlement.service';
import {
  LocalizedText,
  SiteContent,
  SiteSeo,
  SiteTheme,
  sanitizeSeo,
  sanitizeSiteContent,
  sanitizeTheme,
  isTemplateKey,
} from './website-content';
import { INQUIRY_NOTIFY_ROLES } from './website.constants';
import { CreateWebsiteInquiryDto } from './dto/create-website-inquiry.dto';

export interface PublicRoomType {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  fromPrice: number;
  currency: 'THB';
  maxOccupancy: number | null;
  bedType: string | null;
  size: number | null;
  amenities: string[];
  images: string[];
  hidden: boolean;
  order: number;
  /** เฉพาะ preview ของ editor */
  defaults?: { description: string; images: string[] };
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  guestName: string;
  createdAt: Date;
}

export interface SitePayload {
  available: true;
  site: {
    slug: string;
    status: string;
    templateKey: string;
    defaultLang: string;
    theme: SiteTheme;
    seo: SiteSeo;
    content: SiteContent;
    publishedAt: Date | null;
  };
  hotel: {
    name: string;
    nameEn: string | null;
    description: string | null;
    phone: string | null;
    email: string | null;
    location: string | null;
    address: {
      line: string | null;
      district: string | null;
      province: string | null;
      postalCode: string | null;
    };
    checkInTime: string;
    checkOutTime: string;
  };
  roomTypes: PublicRoomType[];
  restaurants: Array<{
    id: string;
    name: string;
    description: string | null;
    type: string;
    openTime: string | null;
    closeTime: string | null;
  }>;
  reviews: { average: number | null; count: number; featured: PublicReview[] };
}

export interface SiteFallbackPayload {
  available: false;
  fallback: { name: string; phone: string | null; address: string | null };
}

const MAX_INQUIRY_NIGHTS = 60;
const MAX_NOTIFY_USERS = 20;

/** "Somchai Kaewdee" → "Somchai K." — หน้าเว็บสาธารณะไม่โชว์นามสกุลเต็มของแขก */
export function toGuestDisplayName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (!f) return l ? `${l.charAt(0)}.` : 'Guest';
  return l ? `${f} ${l.charAt(0)}.` : f;
}

function toAmenityList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) =>
      typeof a === 'string'
        ? a
        : a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string'
          ? (a as { name: string }).name
          : '',
    )
    .map((a) => a.trim())
    .filter(Boolean);
}

function toImageList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x))
    : [];
}

/** วันนี้ตามเวลาไทยในรูป YYYY-MM-DD — แขกเลือกวันตามปฏิทินไทย */
function todayInBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

/** 'YYYY-MM-DD' → Date ที่ UTC midnight (คอลัมน์ @db.Date) */
function toUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * ประกอบข้อมูลหน้าเว็บโรงแรม + รับคำขอจากหน้าเว็บ
 *
 * หน้า public ไม่มี user → tenant-scope middleware ไม่กรองอะไรให้เลย
 * (`if (!tenantId) return next(params)`) ทุก query ในไฟล์นี้จึงต้องกรองด้วย
 * site.tenantId / site.propertyId เองทุกครั้ง และ select เฉพาะฟิลด์ที่โชว์คนนอกได้
 */
@Injectable()
export class WebsitePublicService {
  private readonly logger = new Logger(WebsitePublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlement: WebsiteEntitlementService,
    private readonly notifications: NotificationsService,
  ) {}

  async getPublishedSite(slug: string): Promise<SitePayload | SiteFallbackPayload> {
    const site = await this.findPublishedSite(slug);
    if (!(await this.entitlement.isLive(site.tenantId))) {
      return this.buildFallback(site);
    }
    return this.buildPayload(site, 'published');
  }

  /** ใช้ทั้งหน้า public (published) และ preview ใน editor (draft) */
  async buildPayload(site: WebsiteSite, source: 'published' | 'draft'): Promise<SitePayload> {
    const { tenantId, propertyId } = site;
    const [property, tenant] = await Promise.all([
      this.prisma.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
        select: {
          name: true,
          description: true,
          phone: true,
          email: true,
          location: true,
          standardCheckInTime: true,
          standardCheckOutTime: true,
        },
      }),
      this.prisma.tenants.findUnique({
        where: { id: tenantId },
        select: { name_en: true, address: true, district: true, province: true, postal_code: true },
      }),
    ]);
    if (!property) throw new NotFoundException('Website not found');

    const templateKey = isTemplateKey(site.templateKey) ? site.templateKey : 'classic';
    const rawContent = source === 'published' ? site.publishedContent : site.draftContent;
    const content = sanitizeSiteContent(rawContent, property.name);

    const featuredIds =
      content.sections.find((s) => s.type === 'reviews')?.props.featuredReviewIds ?? [];

    const [roomTypes, restaurants, reviews] = await Promise.all([
      this.buildRoomTypes(tenantId, propertyId, content, source === 'draft'),
      this.prisma.restaurant.findMany({
        where: { tenantId, propertyId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          openTime: true,
          closeTime: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.buildReviews(tenantId, propertyId, featuredIds as string[]),
    ]);

    return {
      available: true,
      site: {
        slug: site.slug,
        status: site.status,
        templateKey,
        defaultLang: site.defaultLang,
        // เว็บจริงใช้สำเนาตอนเผยแพร่ — ร่างที่ยังไม่กด Publish ต้องไม่รั่วขึ้นเว็บ
        theme: sanitizeTheme(
          source === 'published' ? (site.publishedTheme ?? site.theme) : site.theme,
          templateKey,
        ),
        seo: sanitizeSeo(
          source === 'published' ? (site.publishedSeo ?? site.seo) : site.seo,
          property.name,
        ),
        content,
        publishedAt: site.publishedAt,
      },
      hotel: {
        name: property.name,
        nameEn: tenant?.name_en ?? null,
        description: property.description,
        phone: property.phone,
        email: property.email,
        location: property.location,
        address: {
          line: tenant?.address ?? null,
          district: tenant?.district ?? null,
          province: tenant?.province ?? null,
          postalCode: tenant?.postal_code ?? null,
        },
        checkInTime: property.standardCheckInTime,
        checkOutTime: property.standardCheckOutTime,
      },
      roomTypes: source === 'published' ? roomTypes.filter((r) => !r.hidden) : roomTypes,
      restaurants: restaurants.map((r) => ({ ...r, type: String(r.type) })),
      reviews,
    };
  }

  /**
   * ระบบไม่มีโมเดล RoomType — ประเภทห้องคือ Room.type (string) จึงจัดกลุ่มเอง
   * แล้ว merge กับข้อความ/รูปที่เจ้าของแก้ไว้ใน content.roomTypes
   * ห้ามส่งเลขห้อง สถานะห้อง หรือ seasonalRates ดิบออกไป
   */
  async buildRoomTypes(
    tenantId: string,
    propertyId: string,
    content: SiteContent,
    includeDefaults = false,
  ): Promise<PublicRoomType[]> {
    const rooms = await this.prisma.room.findMany({
      where: { tenantId, propertyId },
      select: {
        type: true,
        price: true,
        maxOccupancy: true,
        bedType: true,
        size: true,
        amenities: true,
        images: true,
        description: true,
      },
    });

    const groups = new Map<string, typeof rooms>();
    for (const room of rooms) {
      const key = room.type.trim();
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), room]);
    }

    const result = Array.from(groups.entries()).map(([key, list]): PublicRoomType => {
      const override = content.roomTypes[key];
      const first = list[0];
      const images = Array.from(new Set(list.flatMap((r) => toImageList(r.images))));
      const amenities = Array.from(new Set(list.flatMap((r) => toAmenityList(r.amenities))));
      const occupancies = list
        .map((r) => r.maxOccupancy)
        .filter((n): n is number => typeof n === 'number');
      const fallbackDescription =
        list.find((r) => r.description?.trim())?.description?.trim() ?? '';
      const name = override?.displayName;
      const description = override?.description;

      return {
        key,
        name: { th: name?.th || key, en: name?.en || name?.th || key },
        description: {
          th: description?.th || fallbackDescription,
          en: description?.en || description?.th || fallbackDescription,
        },
        fromPrice: Math.min(...list.map((r) => Number(r.price))),
        currency: 'THB',
        maxOccupancy: occupancies.length ? Math.max(...occupancies) : null,
        bedType: first.bedType,
        size: first.size,
        amenities: amenities.slice(0, 20),
        images: (override?.coverImages.length ? override.coverImages : images).slice(0, 8),
        hidden: override?.hidden ?? false,
        order: override?.order ?? 1000,
        // ค่าจาก PMS ก่อน merge — editor ใช้แสดงค่าเดิมเมื่อเจ้าของล้างข้อความ/รูปที่แก้ทับ
        ...(includeDefaults
          ? { defaults: { description: fallbackDescription, images: images.slice(0, 8) } }
          : {}),
      };
    });

    return result.sort(
      (a, b) => a.order - b.order || a.fromPrice - b.fromPrice || a.key.localeCompare(b.key),
    );
  }

  async buildReviews(
    tenantId: string,
    propertyId: string,
    featuredIds: string[],
  ): Promise<SitePayload['reviews']> {
    const scope = { tenantId, booking: { propertyId } };
    const [agg, featured] = await Promise.all([
      this.prisma.review.aggregate({
        where: scope,
        _avg: { rating: true },
        _count: { _all: true },
      }),
      featuredIds.length
        ? this.prisma.review.findMany({
            where: { ...scope, id: { in: featuredIds } },
            select: {
              id: true,
              rating: true,
              comment: true,
              createdAt: true,
              booking: { select: { guestFirstName: true, guestLastName: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const byId = new Map(featured.map((r) => [r.id, r]));
    return {
      average: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10,
      count: agg._count._all,
      featured: featuredIds
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          guestName: toGuestDisplayName(r.booking?.guestFirstName, r.booking?.guestLastName),
          createdAt: r.createdAt,
        })),
    };
  }

  async createInquiry(slug: string, dto: CreateWebsiteInquiryDto): Promise<{ received: true }> {
    // honeypot: ช่อง `website` ถูกซ่อนในฟอร์ม คนจริงไม่กรอก บอทกรอก → ตอบเหมือนสำเร็จแต่ไม่บันทึก
    if (dto.website && dto.website.trim()) return { received: true };

    const site = await this.findPublishedSite(slug);
    if (!(await this.entitlement.isLive(site.tenantId))) {
      throw new NotFoundException('Website not found');
    }

    const isBooking = dto.type === 'BOOKING_REQUEST';
    if (isBooking) this.assertStayDates(dto.checkIn, dto.checkOut);

    const inquiry = await this.prisma.websiteInquiry.create({
      data: {
        tenantId: site.tenantId,
        siteId: site.id,
        type: dto.type,
        name: dto.name.trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        message: dto.message?.trim() || null,
        checkIn: isBooking && dto.checkIn ? toUtcMidnight(dto.checkIn) : null,
        checkOut: isBooking && dto.checkOut ? toUtcMidnight(dto.checkOut) : null,
        adults: isBooking ? (dto.adults ?? null) : null,
        children: isBooking ? (dto.children ?? null) : null,
        roomType: isBooking ? dto.roomType?.trim() || null : null,
      },
      select: { id: true, type: true, name: true },
    });

    const isRequest = inquiry.type === 'BOOKING_REQUEST';
    await this.notifyStaff(site.tenantId, {
      refId: inquiry.id,
      title: isRequest ? 'คำขอจองใหม่จากเว็บไซต์' : 'ข้อความใหม่จากเว็บไซต์',
      message: `${inquiry.name} ส่งคำขอเข้ามาทางเว็บไซต์โรงแรม`,
    });
    return { received: true };
  }

  // ─── internals ───────────────────────────────────────────────────────

  async findPublishedSite(slug: string): Promise<WebsiteSite> {
    const site = await this.prisma.websiteSite.findFirst({
      where: { slug: (slug ?? '').trim().toLowerCase(), status: 'PUBLISHED' },
    });
    if (!site) throw new NotFoundException('Website not found');
    return site;
  }

  private async buildFallback(site: WebsiteSite): Promise<SiteFallbackPayload> {
    const [property, tenant] = await Promise.all([
      this.prisma.property.findFirst({
        where: { id: site.propertyId, tenantId: site.tenantId },
        select: { name: true, phone: true },
      }),
      this.prisma.tenants.findUnique({
        where: { id: site.tenantId },
        select: { address: true, province: true },
      }),
    ]);
    const address = [tenant?.address, tenant?.province].filter(Boolean).join(' ') || null;
    return {
      available: false,
      fallback: { name: property?.name ?? site.slug, phone: property?.phone ?? null, address },
    };
  }

  assertStayDates(checkIn?: string, checkOut?: string): void {
    if (!checkIn || !checkOut) {
      throw new BadRequestException('กรุณาระบุวันเช็คอินและเช็คเอาท์');
    }
    if (checkIn < todayInBangkok()) {
      throw new BadRequestException('วันเช็คอินต้องไม่ย้อนหลัง');
    }
    const nights =
      (toUtcMidnight(checkOut).getTime() - toUtcMidnight(checkIn).getTime()) / 86_400_000;
    if (!(nights >= 1)) {
      throw new BadRequestException('วันเช็คเอาท์ต้องหลังวันเช็คอิน');
    }
    if (nights > MAX_INQUIRY_NIGHTS) {
      throw new BadRequestException(`จองล่วงหน้าผ่านเว็บได้ไม่เกิน ${MAX_INQUIRY_NIGHTS} คืน`);
    }
  }

  /** แจ้งเตือนพนักงาน — ล้มเหลวได้โดยไม่ทำให้คำขอ/การจองของแขกหาย */
  async notifyStaff(
    tenantId: string,
    note: { refId: string; title: string; message: string },
  ): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { tenantId, status: 'active', role: { in: INQUIRY_NOTIFY_ROLES } },
        select: { id: true },
        take: MAX_NOTIFY_USERS,
      });
      for (const user of users) {
        await this.notifications.create({
          userId: user.id,
          tenantId,
          title: note.title,
          message: note.message,
          type: 'info',
          category: 'website_inquiry',
        });
      }
    } catch (err) {
      this.logger.error(`notifyStaff failed for ${note.refId}: ${(err as Error).message}`);
    }
  }
}
