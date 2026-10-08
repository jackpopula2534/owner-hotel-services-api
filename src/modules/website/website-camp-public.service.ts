import { Injectable, NotFoundException } from '@nestjs/common';
import { WebsiteSite } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  SiteContent,
  sanitizeSeo,
  sanitizeSiteContent,
  sanitizeTheme,
  isTemplateKey,
} from './website-content';
import type { PublicRoomType, SiteFallbackPayload, SitePayload } from './website-public.service';

export interface PublicCampZone {
  type: string;
  pricingMode: 'per_night' | 'per_person';
  basePrice: number;
  weekendPrice: number | null;
  maxGuests: number;
  maxTents: number;
  allowVehicle: boolean;
  allowPet: boolean;
  hasElectricity: boolean;
  electricityFee: number | null;
  restrictions: string[];
  /** จำนวนจุดกางที่เปิดขายของโซน (ไม่นับจุดปิด/ซ่อม) */
  pitchCount: number;
  /** รหัสนำหน้าจุด (เช่น "A") + สีหมุดบนแผนที่ — ตรงกับแผนผังหลังบ้าน */
  code: string | null;
  color: string | null;
}

export interface PublicCampEquipment {
  id: string;
  name: string;
  category: string;
  description: string | null;
  pricePerUnit: number;
  unit: string;
  deposit: number | null;
  images: string[];
}

export interface PublicCampFacility {
  name: string;
  type: string;
  open24h: boolean;
  openingTime: string | null;
  closingTime: string | null;
  /** พิกัด normalized บนแผนที่ (0..1) */
  posX: number;
  posY: number;
}

/** จุดกางบนแผนที่ — ไม่มีสถานะ/การจอง (จุดว่างรายวันมาจาก camp-availability) */
export interface PublicCampPitch {
  id: string;
  code: string;
  /** CampZone.id = roomTypes[].key */
  zoneKey: string;
  posX: number;
  posY: number;
  /** รูปของจุดนี้ที่อัปโหลดในหลังบ้าน (แขกกดหมุดแล้วเห็นรูปจุดจริง) */
  images: string[];
}

/** รูปแผนผังที่เจ้าของลานอัปโหลดในหลังบ้าน + จุดกางที่เปิดขาย */
export interface PublicCampMap {
  imageUrl: string;
  width: number | null;
  height: number | null;
  pitches: PublicCampPitch[];
}

/** ข้อมูลเฉพาะเว็บลาน — key ของ zones ตรงกับ roomTypes[].key (= CampZone.id) */
export interface CampSiteExtras {
  zones: Record<string, PublicCampZone>;
  equipment: PublicCampEquipment[];
  facilities: PublicCampFacility[];
  /** null = ลานยังไม่อัปโหลดรูปแผนผัง */
  map: PublicCampMap | null;
  latitude: number | null;
  longitude: number | null;
}

/** จุดที่ปิดขายถาวร/ซ่อมอยู่ — สถานะอื่น (occupied/cleaning) เป็นสถานะ "ตอนนี้" ไม่เกี่ยวกับวันในอนาคต */
export const UNSELLABLE_PITCH_STATUSES = ['maintenance', 'closed'];

const MAX_ZONE_IMAGES = 8;
const MAX_EQUIPMENT = 60;

/** ตรงกับเพดานอัปโหลดรูปต่อจุดในหลังบ้าน */
const MAX_PITCH_IMAGES = 12;

function toImageList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x))
    : [];
}

function toStringList(raw: unknown, max: number): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

/** รูปแผนผังมาจาก storage (http/https หรือ path ของเว็บเอง เช่น /uploads/..., /assets/...) */
export function toMapImageUrl(raw: string | null | undefined): string | null {
  const url = raw?.trim();
  if (!url || url.length > 500) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return /^\/(?!\/)[\w\-./%]+$/.test(url) ? url : null;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

const num = (v: { toString(): string } | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * ประกอบข้อมูลหน้าเว็บของลานกางเต็นท์ (site.campgroundId != null)
 *
 * shape เดียวกับเว็บโรงแรม (SitePayload) เพื่อให้หน้าเว็บ/editor ใช้ร่วมกันได้:
 *   hotel     → ข้อมูลลาน
 *   roomTypes → โซน (key = zone.id) ราคาเริ่มต้นจาก basePrice
 *   camp      → ข้อมูลเฉพาะลาน (กติกาโซน อุปกรณ์ให้เช่า สิ่งอำนวยความสะดวก)
 * หน้า public ไม่มี tenant context → ทุก query กรอง tenantId + campgroundId เอง
 * รหัส/ตำแหน่งจุดกางส่งได้ (พิมพ์อยู่บนแผนผังอยู่แล้ว) แต่ห้ามส่งสถานะจุดหรือข้อมูลการจองออกไป
 */
@Injectable()
export class WebsiteCampPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async findCampground(site: WebsiteSite) {
    if (!site.campgroundId) throw new NotFoundException('Website not found');
    const campground = await this.prisma.campground.findFirst({
      where: { id: site.campgroundId, tenantId: site.tenantId },
      select: {
        id: true,
        name: true,
        description: true,
        address: true,
        phone: true,
        latitude: true,
        longitude: true,
        images: true,
        checkInTime: true,
        checkOutTime: true,
        warehouseId: true,
        mapImageUrl: true,
        mapWidth: true,
        mapHeight: true,
      },
    });
    if (!campground) throw new NotFoundException('Website not found');
    return campground;
  }

  async buildPayload(site: WebsiteSite, source: 'published' | 'draft'): Promise<SitePayload> {
    const campground = await this.findCampground(site);
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: site.tenantId },
      select: { name_en: true, district: true, province: true, postal_code: true },
    });

    const templateKey = isTemplateKey(site.templateKey) ? site.templateKey : 'classic';
    const rawContent = source === 'published' ? site.publishedContent : site.draftContent;
    const content = sanitizeSiteContent(rawContent, campground.name, 'camp');

    const [zones, equipment, facilities] = await Promise.all([
      this.buildZones(site.tenantId, campground, content, source === 'draft'),
      this.listEquipment(site.tenantId, campground.id),
      this.prisma.campFacility.findMany({
        where: { tenantId: site.tenantId, campgroundId: campground.id, status: { not: 'closed' } },
        select: {
          name: true,
          type: true,
          open24h: true,
          openingTime: true,
          closingTime: true,
          posX: true,
          posY: true,
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
    ]);

    const roomTypes =
      source === 'published' ? zones.roomTypes.filter((r) => !r.hidden) : zones.roomTypes;
    const visibleZones = new Set(roomTypes.map((r) => r.key));
    const mapImageUrl = toMapImageUrl(campground.mapImageUrl);

    return {
      available: true,
      kind: 'camp',
      site: {
        slug: site.slug,
        status: site.status,
        templateKey,
        defaultLang: site.defaultLang,
        theme: sanitizeTheme(
          source === 'published' ? (site.publishedTheme ?? site.theme) : site.theme,
          templateKey,
        ),
        seo: sanitizeSeo(
          source === 'published' ? (site.publishedSeo ?? site.seo) : site.seo,
          campground.name,
        ),
        content,
        publishedAt: site.publishedAt,
      },
      hotel: {
        name: campground.name,
        nameEn: tenant?.name_en ?? null,
        description: campground.description,
        phone: campground.phone,
        email: null,
        location: campground.address,
        address: {
          line: campground.address,
          district: tenant?.district ?? null,
          province: tenant?.province ?? null,
          postalCode: tenant?.postal_code ?? null,
        },
        checkInTime: campground.checkInTime ?? '14:00',
        checkOutTime: campground.checkOutTime ?? '12:00',
      },
      roomTypes,
      restaurants: [],
      reviews: { average: null, count: 0, featured: [] },
      camp: {
        zones: zones.extras,
        equipment,
        facilities: facilities.map((f) => ({ ...f, posX: clamp01(f.posX), posY: clamp01(f.posY) })),
        map: mapImageUrl
          ? {
              imageUrl: mapImageUrl,
              width: campground.mapWidth,
              height: campground.mapHeight,
              pitches: zones.pitches.filter((p) => visibleZones.has(p.zoneKey)),
            }
          : null,
        latitude: campground.latitude,
        longitude: campground.longitude,
      },
    };
  }

  async buildFallback(site: WebsiteSite): Promise<SiteFallbackPayload> {
    const campground = await this.prisma.campground.findFirst({
      where: { id: site.campgroundId ?? '', tenantId: site.tenantId },
      select: { name: true, phone: true, address: true },
    });
    return {
      available: false,
      fallback: {
        name: campground?.name ?? site.slug,
        phone: campground?.phone ?? null,
        address: campground?.address ?? null,
      },
    };
  }

  /** ชื่อลาน — ใช้เป็นชื่อเริ่มต้นของ SEO/หัวเว็บ */
  async siteName(site: WebsiteSite): Promise<string> {
    const campground = await this.prisma.campground.findFirst({
      where: { id: site.campgroundId ?? '', tenantId: site.tenantId },
      select: { name: true },
    });
    return campground?.name ?? site.slug;
  }

  private async buildZones(
    tenantId: string,
    campground: { id: string; images: unknown },
    content: SiteContent,
    includeDefaults: boolean,
  ): Promise<{
    roomTypes: PublicRoomType[];
    extras: Record<string, PublicCampZone>;
    pitches: PublicCampPitch[];
  }> {
    const zones = await this.prisma.campZone.findMany({
      where: { tenantId, campgroundId: campground.id },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        basePrice: true,
        weekendPrice: true,
        maxGuests: true,
        maxTents: true,
        allowVehicle: true,
        allowPet: true,
        pricingMode: true,
        hasElectricity: true,
        electricityFee: true,
        restrictions: true,
        code: true,
        color: true,
        pitches: {
          where: { status: { notIn: UNSELLABLE_PITCH_STATUSES } },
          select: { id: true, code: true, posX: true, posY: true, images: true, sizeSqm: true },
          orderBy: { code: 'asc' },
        },
      },
      orderBy: [{ basePrice: 'asc' }, { name: 'asc' }],
    });
    const groundImages = toImageList(campground.images);

    const roomTypes: PublicRoomType[] = [];
    const extras: Record<string, PublicCampZone> = {};
    const pitches: PublicCampPitch[] = [];
    for (const zone of zones) {
      // โซนที่ไม่มีจุดเปิดขายเลย จองไม่ได้ → ไม่โชว์บนเว็บ
      if (!zone.pitches.length) continue;
      const override = content.roomTypes[zone.id];
      const pitchImages = Array.from(new Set(zone.pitches.flatMap((p) => toImageList(p.images))));
      const defaultImages = (pitchImages.length ? pitchImages : groundImages).slice(
        0,
        MAX_ZONE_IMAGES,
      );
      const sizes = zone.pitches
        .map((p) => p.sizeSqm)
        .filter((n): n is number => typeof n === 'number');
      const name = override?.displayName;
      const description = override?.description;
      const fallbackDescription = zone.description?.trim() ?? '';

      roomTypes.push({
        key: zone.id,
        name: { th: name?.th || zone.name, en: name?.en || name?.th || zone.name },
        description: {
          th: description?.th || fallbackDescription,
          en: description?.en || description?.th || fallbackDescription,
        },
        fromPrice: Number(zone.basePrice),
        currency: 'THB',
        maxOccupancy: zone.maxGuests,
        bedType: null,
        size: sizes.length ? Math.max(...sizes) : null,
        amenities: [],
        images: (override?.coverImages.length ? override.coverImages : defaultImages).slice(
          0,
          MAX_ZONE_IMAGES,
        ),
        hidden: override?.hidden ?? false,
        order: override?.order ?? 1000,
        ...(includeDefaults
          ? {
              defaults: {
                description: fallbackDescription,
                images: defaultImages,
                name: zone.name,
              },
            }
          : {}),
      });
      extras[zone.id] = {
        type: zone.type,
        pricingMode: zone.pricingMode === 'per_person' ? 'per_person' : 'per_night',
        basePrice: Number(zone.basePrice),
        weekendPrice: num(zone.weekendPrice),
        maxGuests: zone.maxGuests,
        maxTents: zone.maxTents,
        allowVehicle: zone.allowVehicle,
        allowPet: zone.allowPet,
        hasElectricity: zone.hasElectricity,
        electricityFee: zone.hasElectricity ? num(zone.electricityFee) : null,
        restrictions: toStringList(zone.restrictions, 12),
        pitchCount: zone.pitches.length,
        code: zone.code?.trim() || null,
        color: zone.color && /^#[0-9a-f]{3,8}$/i.test(zone.color) ? zone.color : null,
      };
      for (const p of zone.pitches) {
        pitches.push({
          id: p.id,
          code: p.code,
          zoneKey: zone.id,
          posX: clamp01(p.posX),
          posY: clamp01(p.posY),
          images: toImageList(p.images).slice(0, MAX_PITCH_IMAGES),
        });
      }
    }

    roomTypes.sort((a, b) => a.order - b.order || a.fromPrice - b.fromPrice);
    return { roomTypes, extras, pitches };
  }

  async listEquipment(tenantId: string, campgroundId: string): Promise<PublicCampEquipment[]> {
    const rows = await this.prisma.campAddon.findMany({
      where: { tenantId, campgroundId, active: true },
      select: {
        id: true,
        name: true,
        category: true,
        description: true,
        pricePerUnit: true,
        unit: true,
        deposit: true,
        images: true,
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: MAX_EQUIPMENT,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      pricePerUnit: Number(r.pricePerUnit),
      unit: r.unit,
      deposit: num(r.deposit) || null,
      images: toImageList(r.images).slice(0, 4),
    }));
  }
}
