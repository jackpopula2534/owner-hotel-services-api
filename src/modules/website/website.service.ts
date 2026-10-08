import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebsiteInquiry, WebsiteSite } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantContextService } from '@/common/tenant/tenant-context.service';
import { StorageService, UploadableFile } from '@/common/storage/storage.service';
import {
  PublishBlockReason,
  PublishEligibility,
  WebsiteEntitlementService,
} from './website-entitlement.service';
import {
  PublicReview,
  SitePayload,
  WebsitePublicService,
  toGuestDisplayName,
} from './website-public.service';
import {
  buildDefaultContent,
  sanitizeSeo,
  sanitizeSiteContent,
  sanitizeTheme,
  isTemplateKey,
} from './website-content';
import { SiteKind, TemplateKey, normalizeSlug, validateSlug } from './website.constants';
import { AddonService } from '../addons/addon.service';
import { CreateWebsiteSiteDto } from './dto/create-website-site.dto';
import { UpdateWebsiteSiteDto } from './dto/update-website-site.dto';
import { UpdateWebsiteInquiryDto, WebsiteInquiryQueryDto } from './dto/website-inquiry-query.dto';

/** MVP เปิดให้ 1 เว็บต่อ tenant (schema รองรับ 1 เว็บต่อ property แล้ว) */
const MAX_SITES_PER_TENANT = 1;
const MAX_REVIEW_OPTIONS = 50;

const PUBLISH_BLOCK_MESSAGES: Record<PublishBlockReason, string> = {
  TRIAL: 'ช่วงทดลองใช้แก้ไขและดูตัวอย่างเว็บได้ แต่เปิดเว็บสาธารณะได้หลังชำระเงินแล้วเท่านั้น',
  WRONG_PRODUCT_LINE: 'แผนปัจจุบันของคุณใช้ฟีเจอร์เว็บไซต์ไม่ได้',
  ADDON_REQUIRED: 'ต้องมี add-on "เว็บไซต์ + จองออนไลน์" ที่ยังใช้งานอยู่จึงจะเปิดเว็บได้',
};

export type SiteWithEligibility = WebsiteSite & {
  publicHost: string | null;
  eligibility: PublishEligibility;
};

const siteKind = (site: WebsiteSite): SiteKind => (site.campgroundId ? 'camp' : 'hotel');

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * ฝั่งเจ้าของโรงแรม: สร้าง/แก้/เผยแพร่เว็บ + กล่องคำขอ
 * ทุก query กรอง tenantId เอง (findFirst({ id, tenantId })) ไม่พึ่ง middleware
 */
@Injectable()
export class WebsiteService {
  private readonly logger = new Logger(WebsiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly entitlement: WebsiteEntitlementService,
    private readonly publicService: WebsitePublicService,
    private readonly addons: AddonService,
  ) {}

  // ─── sites ───────────────────────────────────────────────────────────

  async listSites(tenantId: string): Promise<SiteWithEligibility[]> {
    const sites = await this.prisma.websiteSite.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!sites.length) return [];
    const eligibility = await this.entitlement.checkPublishable(tenantId);
    return sites.map((s) => this.decorate(s, eligibility));
  }

  async getSite(id: string, tenantId: string): Promise<SiteWithEligibility> {
    const site = await this.findSite(id, tenantId);
    return this.decorate(site, await this.entitlement.checkPublishable(tenantId));
  }

  async createSite(tenantId: string, dto: CreateWebsiteSiteDto): Promise<SiteWithEligibility> {
    const existing = await this.prisma.websiteSite.count({ where: { tenantId } });
    if (existing >= MAX_SITES_PER_TENANT) {
      throw new ConflictException('โรงแรมนี้มีเว็บไซต์อยู่แล้ว');
    }

    const property = await this.resolveProperty(tenantId, dto.propertyId);
    const campground = await this.resolveCampground(tenantId, dto.campgroundId);
    const slug = await this.assertSlugAvailable(dto.slug);
    const templateKey: TemplateKey = dto.templateKey ?? 'classic';

    // เว็บลาน: ชื่อ/เบอร์/คำอธิบายมาจากลาน, section dining = สิ่งอำนวยความสะดวก + อุปกรณ์ให้เช่า
    const name = campground?.name ?? property.name;
    const description = campground ? campground.description : property.description;
    const hasRestaurants = campground
      ? (await this.prisma.campFacility.count({
          where: { tenantId, campgroundId: campground.id },
        })) +
          (await this.prisma.campAddon.count({
            where: { tenantId, campgroundId: campground.id, active: true },
          })) >
        0
      : (await this.prisma.restaurant.count({
          where: { tenantId, propertyId: property.id, isActive: true },
        })) > 0;

    const content = buildDefaultContent({
      hotelName: name,
      phone: campground ? (campground.phone ?? property.phone) : property.phone,
      email: property.email,
      hasRestaurants,
      kind: campground ? 'camp' : 'hotel',
    });

    try {
      const site = await this.prisma.websiteSite.create({
        data: {
          tenantId,
          propertyId: property.id,
          campgroundId: campground?.id ?? null,
          slug,
          templateKey,
          theme: asJson(sanitizeTheme({}, templateKey)),
          draftContent: asJson(content),
          seo: asJson(sanitizeSeo({ description: { th: description ?? '' } }, name)),
        },
      });
      this.logger.log(`Website ${site.id} (${slug}) created for tenant ${tenantId}`);
      return this.getSite(site.id, tenantId);
    } catch (err) {
      throw this.mapUniqueError(err);
    }
  }

  async updateSite(
    id: string,
    tenantId: string,
    dto: UpdateWebsiteSiteDto,
  ): Promise<SiteWithEligibility> {
    const site = await this.findSite(id, tenantId);
    const hotelName = await this.getHotelName(site);

    const templateKey: TemplateKey =
      dto.templateKey ?? (isTemplateKey(site.templateKey) ? site.templateKey : 'classic');
    const templateChanged = templateKey !== site.templateKey;
    const currentLogo = (site.theme as { logoUrl?: unknown } | null)?.logoUrl;

    const data: Prisma.WebsiteSiteUpdateInput = {};
    if (dto.slug !== undefined && normalizeSlug(dto.slug) !== site.slug) {
      data.slug = await this.assertSlugAvailable(dto.slug, site.id);
    }
    if (dto.templateKey !== undefined) data.templateKey = templateKey;
    if (dto.defaultLang !== undefined) data.defaultLang = dto.defaultLang;
    if (dto.theme !== undefined || templateChanged) {
      // เปลี่ยนเทมเพลตโดยไม่ส่ง theme มา → ใช้สีตั้งต้นของเทมเพลตใหม่ แต่คงโลโก้เดิม
      const themeInput = dto.theme ?? { logoUrl: currentLogo };
      data.theme = asJson(sanitizeTheme(themeInput, templateKey));
    }
    if (dto.content !== undefined)
      data.draftContent = asJson(sanitizeSiteContent(dto.content, hotelName, siteKind(site)));
    if (dto.seo !== undefined) data.seo = asJson(sanitizeSeo(dto.seo, hotelName));

    try {
      await this.prisma.websiteSite.update({ where: { id: site.id }, data });
    } catch (err) {
      throw this.mapUniqueError(err);
    }
    return this.getSite(site.id, tenantId);
  }

  async publish(id: string, tenantId: string): Promise<SiteWithEligibility> {
    const site = await this.findSite(id, tenantId);
    const eligibility = await this.entitlement.checkPublishable(tenantId);
    if (!eligibility.ok && eligibility.reason) {
      throw new ForbiddenException({
        code: `WEBSITE_PUBLISH_${eligibility.reason}`,
        message: PUBLISH_BLOCK_MESSAGES[eligibility.reason],
        addon: 'WEBSITE_BUILDER',
      });
    }

    const hotelName = await this.getHotelName(site);
    const content = sanitizeSiteContent(site.draftContent, hotelName, siteKind(site));
    const templateKey = isTemplateKey(site.templateKey) ? site.templateKey : 'classic';
    await this.prisma.websiteSite.update({
      where: { id: site.id },
      data: {
        status: 'PUBLISHED',
        publishedContent: asJson(content),
        publishedTheme: asJson(sanitizeTheme(site.theme, templateKey)),
        publishedSeo: asJson(sanitizeSeo(site.seo, hotelName)),
        publishedAt: new Date(),
      },
    });
    this.logger.log(`Website ${site.id} (${site.slug}) published by tenant ${tenantId}`);
    return this.getSite(site.id, tenantId);
  }

  async unpublish(id: string, tenantId: string): Promise<SiteWithEligibility> {
    const site = await this.findSite(id, tenantId);
    await this.prisma.websiteSite.update({
      where: { id: site.id },
      data: { status: 'UNPUBLISHED' },
    });
    return this.getSite(site.id, tenantId);
  }

  async preview(id: string, tenantId: string): Promise<SitePayload> {
    const site = await this.findSite(id, tenantId);
    return this.publicService.buildPayload(site, 'draft');
  }

  /** slug ต้องไม่ซ้ำทั้งแพลตฟอร์ม → ค้นแบบไม่ scope tenant (ไม่งั้นเห็นแค่ของตัวเองแล้วตอบว่าว่าง) */
  async checkSlug(
    rawSlug: string,
    excludeSiteId?: string,
  ): Promise<{ slug: string; available: boolean; reason: string | null }> {
    const slug = normalizeSlug(rawSlug);
    const invalid = validateSlug(slug);
    if (invalid) return { slug, available: false, reason: invalid };
    const taken = await this.isSlugTaken(slug, excludeSiteId);
    return { slug, available: !taken, reason: taken ? 'ชื่อนี้มีโรงแรมอื่นใช้แล้ว' : null };
  }

  async uploadImages(tenantId: string, files: UploadableFile[]): Promise<{ urls: string[] }> {
    if (!files?.length) throw new BadRequestException('ไม่พบไฟล์รูป');
    const saved = await this.storage.saveMany(files, {
      folder: `website/${tenantId}`,
      prefix: 'site',
    });
    return { urls: saved.map((s) => s.url) };
  }

  /** รายการรีวิวของ property ให้ editor เลือกไปโชว์ในหน้าเว็บ */
  async reviewOptions(id: string, tenantId: string): Promise<PublicReview[]> {
    const site = await this.findSite(id, tenantId);
    // ลานกางเต็นท์ยังไม่มีระบบรีวิว
    if (site.campgroundId) return [];
    const reviews = await this.prisma.review.findMany({
      where: { tenantId, booking: { propertyId: site.propertyId } },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        booking: { select: { guestFirstName: true, guestLastName: true } },
      },
      orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
      take: MAX_REVIEW_OPTIONS,
    });
    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      guestName: toGuestDisplayName(r.booking?.guestFirstName, r.booking?.guestLastName),
    }));
  }

  // ─── inquiries ───────────────────────────────────────────────────────

  async listInquiries(
    tenantId: string,
    query: WebsiteInquiryQueryDto,
  ): Promise<{ data: WebsiteInquiry[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.WebsiteInquiryWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.websiteInquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.websiteInquiry.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async countNewInquiries(tenantId: string): Promise<{ count: number }> {
    const count = await this.prisma.websiteInquiry.count({ where: { tenantId, status: 'NEW' } });
    return { count };
  }

  async updateInquiry(
    id: string,
    tenantId: string,
    dto: UpdateWebsiteInquiryDto,
  ): Promise<WebsiteInquiry> {
    const inquiry = await this.prisma.websiteInquiry.findFirst({ where: { id, tenantId } });
    if (!inquiry) throw new NotFoundException('ไม่พบคำขอนี้');

    const data: Prisma.WebsiteInquiryUncheckedUpdateInput = {};
    if (dto.bookingId !== undefined) {
      if (dto.bookingId) {
        // bookingId มี FK แต่ FK ไม่รู้จัก tenant — ต้องเช็คเองว่าเป็นการจองของโรงแรมนี้
        const booking = await this.prisma.booking.findFirst({
          where: { id: dto.bookingId, tenantId },
          select: { id: true },
        });
        if (!booking) throw new BadRequestException('ไม่พบการจองนี้ในโรงแรมของคุณ');
      }
      data.bookingId = dto.bookingId || null;
      if (dto.bookingId && !dto.status) data.status = 'CONVERTED';
    }
    if (dto.status) data.status = dto.status;

    return this.prisma.websiteInquiry.update({ where: { id: inquiry.id }, data });
  }

  // ─── internals ───────────────────────────────────────────────────────

  private async findSite(id: string, tenantId: string): Promise<WebsiteSite> {
    const site = await this.prisma.websiteSite.findFirst({ where: { id, tenantId } });
    if (!site) throw new NotFoundException('ไม่พบเว็บไซต์');
    return site;
  }

  private decorate(site: WebsiteSite, eligibility: PublishEligibility): SiteWithEligibility {
    const root = this.config.get<string>('WEBSITE_ROOT_DOMAIN');
    return { ...site, publicHost: root ? `${site.slug}.${root}` : null, eligibility };
  }

  private async getHotelName(site: WebsiteSite): Promise<string> {
    if (site.campgroundId) {
      const campground = await this.prisma.campground.findFirst({
        where: { id: site.campgroundId, tenantId: site.tenantId },
        select: { name: true },
      });
      return campground?.name ?? site.slug;
    }
    const property = await this.prisma.property.findFirst({
      where: { id: site.propertyId, tenantId: site.tenantId },
      select: { name: true },
    });
    return property?.name ?? site.slug;
  }

  private async resolveProperty(
    tenantId: string,
    propertyId?: string,
  ): Promise<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    description: string | null;
  }> {
    const select = { id: true, name: true, phone: true, email: true, description: true };
    const property = propertyId
      ? await this.prisma.property.findFirst({
          where: { id: propertyId, tenantId, deletedAt: null },
          select,
        })
      : await this.prisma.property.findFirst({
          where: { tenantId, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select,
        });
    if (!property) throw new BadRequestException('ไม่พบที่พักสำหรับสร้างเว็บไซต์');
    return property;
  }

  /**
   * เว็บลานกางเต็นท์ = ระบุ campgroundId มา หรือ tenant อยู่สาย CAMP (ใช้ลานแรกที่เปิดอยู่)
   * คืน null = เว็บโรงแรม
   */
  private async resolveCampground(
    tenantId: string,
    campgroundId?: string,
  ): Promise<{
    id: string;
    name: string;
    phone: string | null;
    description: string | null;
  } | null> {
    const select = { id: true, name: true, phone: true, description: true };
    if (campgroundId) {
      const campground = await this.prisma.campground.findFirst({
        where: { id: campgroundId, tenantId },
        select,
      });
      if (!campground) throw new BadRequestException('ไม่พบลานกางเต็นท์นี้');
      return campground;
    }
    if ((await this.addons.getTenantSystem(tenantId)) !== 'CAMP') return null;
    const campground = await this.prisma.campground.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select,
    });
    if (!campground) throw new BadRequestException('กรุณาสร้างลานกางเต็นท์ก่อนสร้างเว็บไซต์');
    return campground;
  }

  private async assertSlugAvailable(rawSlug: string, excludeSiteId?: string): Promise<string> {
    const result = await this.checkSlug(rawSlug, excludeSiteId);
    if (!result.available) {
      if (result.reason && validateSlug(result.slug)) throw new BadRequestException(result.reason);
      throw new ConflictException(result.reason ?? 'ชื่อนี้ใช้ไม่ได้');
    }
    return result.slug;
  }

  private async isSlugTaken(slug: string, excludeSiteId?: string): Promise<boolean> {
    // ต้อง await ภายใน callback: PrismaPromise เป็น lazy ถ้าคืน promise ออกไปเฉย ๆ
    // query จะรันตอน await นอกเฟรม ALS → middleware ยังกรอง tenant อยู่ (เห็นแค่ slug ของตัวเอง)
    const hit = await this.tenantContext.runUnscoped(async () => {
      return await this.prisma.websiteSite.findFirst({
        where: { slug, ...(excludeSiteId ? { id: { not: excludeSiteId } } : {}) },
        select: { id: true },
      });
    });
    return Boolean(hit);
  }

  /** กันกรณีสองคนจอง slug เดียวกันพร้อมกัน — เช็คก่อนแล้วยังชนที่ unique index ได้ */
  private mapUniqueError(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('ชื่อนี้มีโรงแรมอื่นใช้แล้ว');
    }
    return err;
  }
}
