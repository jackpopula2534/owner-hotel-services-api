import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomPromoCode } from '../../inventory/retail-promotions/promotion-engine';
import {
  IssueResult,
  IssuedPromoCode,
  PROMO_CAMPAIGN_CHANNELS,
} from './campaign-promo-code.service';

const CODE_PREFIX = 'R';
const CODE_LENGTH = 7;
const MAX_CODE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** สถานะการจองที่ไม่นับเป็นการใช้โค้ด (ตรงกับ PropertyPromoCodesService) */
const NOT_COUNTED_STATUSES = ['cancelled'];

export interface CampaignRoomPromoStats {
  roomPromoCodeId: string;
  /** โค้ดต้นแบบ (null = ถูกลบไปแล้ว) */
  templateCode: string | null;
  codesIssued: number;
  /** โค้ดที่ถูกใช้จองแล้ว (ไม่นับการจองที่ยกเลิก) */
  codesRedeemed: number;
  bookings: number;
  discountTotal: number;
  /** ยอดค่าห้องของการจองที่ใช้โค้ด */
  revenueTotal: number;
  redemptionRate: number;
}

export interface RoomPromoTemplateOption {
  id: string;
  code: string;
  description: string | null;
  propertyId: string;
  propertyName: string | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  validUntil: string | null;
  isActive: boolean;
  /** เปิดใช้และยังไม่หมดเขต → เลือกผูกแคมเปญได้ */
  linkable: boolean;
  /** โค้ดเฉพาะคนที่แคมเปญออกจากโค้ดนี้แล้ว */
  personalCodesIssued: number;
}

type StatsCore = Omit<CampaignRoomPromoStats, 'roomPromoCodeId' | 'templateCode'>;

/** @db.Date = UTC midnight ของวันที่ตามเวลาไทย */
const bangkokDbDate = (at: Date): Date =>
  new Date(
    `${new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00.000Z`,
  );

/**
 * วันสุดท้ายที่ใช้โค้ดเฉพาะคนได้: วันส่ง + N วัน (เวลาไทย) แต่ไม่เกินวันจบของโค้ดต้นแบบ
 * null = ไม่มีวันหมดอายุ
 */
export function roomCodeValidUntil(
  now: Date,
  validDays: number | null,
  templateValidUntil: Date | null,
): Date | null {
  const byDays = validDays ? bangkokDbDate(new Date(now.getTime() + validDays * DAY_MS)) : null;
  if (byDays && templateValidUntil)
    return byDays < templateValidUntil ? byDays : templateValidUntil;
  return byDays ?? templateValidUntil;
}

/**
 * แคมเปญ CRM แจกโค้ดส่วนลดห้องพัก — ออกโค้ดลูก (property_promo_codes.parentId) ให้ผู้รับทีละคน
 * เงื่อนไขส่วนลดคัดลอกจากโค้ดต้นแบบ, ใช้ได้ 1 การจอง, ผูก issuedToGuestId
 * 1 delivery = 1 โค้ด (unique campaignDeliveryId) — คิว retry ได้โค้ดเดิม
 */
@Injectable()
export class CampaignRoomPromoCodeService {
  private readonly logger = new Logger(CampaignRoomPromoCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ตรวจตอนสร้างแคมเปญ — โค้ดต้นแบบต้องเป็นของ tenant นี้ เปิดใช้ และยังไม่หมดเขต */
  async assertLinkable(tenantId: string, roomPromoCodeId: string, channel: string): Promise<void> {
    if (!(PROMO_CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException({
        code: 'PROMO_CAMPAIGN_CHANNEL',
        message: 'แคมเปญแจกโค้ดส่งได้ทาง LINE หรืออีเมลเท่านั้น',
      });
    }
    const template = await this.prisma.propertyPromoCode.findFirst({
      where: { id: roomPromoCodeId, tenantId, parentId: null },
      select: { isActive: true, validUntil: true },
    });
    if (!template) {
      throw new BadRequestException({
        code: 'ROOM_PROMO_NOT_FOUND',
        message: 'ไม่พบโค้ดส่วนลดห้องพักที่เลือก',
      });
    }
    if (!template.isActive) {
      throw new BadRequestException({
        code: 'ROOM_PROMO_INACTIVE',
        message: 'โค้ดส่วนลดห้องพักนี้ปิดใช้งานอยู่',
      });
    }
    if (template.validUntil && template.validUntil < bangkokDbDate(new Date())) {
      throw new BadRequestException({
        code: 'ROOM_PROMO_ENDED',
        message: 'โค้ดส่วนลดห้องพักนี้หมดเขตแล้ว',
      });
    }
  }

  /** โค้ดต้นแบบทุก property ของ tenant — ตัวเลือกในฟอร์มแคมเปญ + การ์ดหน้า CRM */
  async listTemplates(tenantId: string): Promise<RoomPromoTemplateOption[]> {
    const rows = await this.prisma.propertyPromoCode.findMany({
      where: { tenantId, parentId: null, property: { deletedAt: null } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { property: { select: { name: true } } },
    });
    const issued = rows.length
      ? await this.prisma.propertyPromoCode.groupBy({
          by: ['parentId'],
          where: { tenantId, parentId: { in: rows.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    const issuedBy = new Map(issued.map((g) => [g.parentId as string, g._count._all]));
    const today = bangkokDbDate(new Date());
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      description: r.description,
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? null,
      discountType: r.discountType === 'fixed' ? 'fixed' : 'percentage',
      discountValue: Number(r.discountValue),
      validUntil: r.validUntil ? r.validUntil.toISOString().slice(0, 10) : null,
      isActive: r.isActive,
      linkable: r.isActive && !(r.validUntil && r.validUntil < today),
      personalCodesIssued: issuedBy.get(r.id) ?? 0,
    }));
  }

  async issueForDelivery(params: {
    tenantId: string;
    campaignId: string;
    roomPromoCodeId: string;
    deliveryId: string;
    guestId: string | null;
    validDays: number | null;
  }): Promise<IssueResult> {
    const { tenantId, campaignId, roomPromoCodeId, deliveryId, guestId } = params;
    if (!guestId) return { ok: false, reason: 'ผู้รับไม่ได้ผูกกับข้อมูลแขก — ออกโค้ดไม่ได้' };

    const existing = await this.findForDelivery(tenantId, deliveryId);
    if (existing) return { ok: true, code: existing };

    const template = await this.prisma.propertyPromoCode.findFirst({
      where: { id: roomPromoCodeId, tenantId, parentId: null },
    });
    if (!template || !template.isActive) {
      return { ok: false, reason: 'โค้ดส่วนลดห้องพักต้นแบบถูกลบหรือปิดใช้งานแล้ว' };
    }
    const now = new Date();
    if (template.validUntil && template.validUntil < bangkokDbDate(now)) {
      return { ok: false, reason: 'โค้ดส่วนลดห้องพักต้นแบบหมดเขตแล้ว' };
    }
    const validUntil = roomCodeValidUntil(now, params.validDays, template.validUntil);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        const created = await this.prisma.propertyPromoCode.create({
          data: {
            tenantId,
            propertyId: template.propertyId,
            code: `${CODE_PREFIX}${randomPromoCode(CODE_LENGTH)}`,
            description: template.description,
            discountType: template.discountType,
            discountValue: template.discountValue,
            maxDiscount: template.maxDiscount,
            minNights: template.minNights,
            minAmount: template.minAmount,
            validFrom: template.validFrom,
            validUntil,
            usageLimit: 1,
            isActive: true,
            parentId: template.id,
            issuedToGuestId: guestId,
            campaignId,
            campaignDeliveryId: deliveryId,
          },
          select: { id: true, code: true, validUntil: true },
        });
        return { ok: true, code: toIssued(created) };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002')
          throw err;
        // ชน unique: delivery นี้มีโค้ดแล้ว (job ซ้อน) → ใช้ตัวเดิม · ไม่งั้นโค้ดสุ่มชน → สุ่มใหม่
        const raced = await this.findForDelivery(tenantId, deliveryId);
        if (raced) return { ok: true, code: raced };
      }
    }
    this.logger.error(`issueForDelivery ${deliveryId}: could not generate a unique room code`);
    return { ok: false, reason: 'สร้างโค้ดไม่สำเร็จ' };
  }

  /** ส่งไม่สำเร็จ — ปิดโค้ดที่ออกไว้ (ไม่มีใครได้รับ จึงยังไม่มีการจองที่ใช้โค้ดนี้) */
  async revokeForDelivery(tenantId: string, deliveryId: string): Promise<void> {
    await this.prisma.propertyPromoCode.updateMany({
      where: { tenantId, campaignDeliveryId: deliveryId },
      data: { isActive: false },
    });
  }

  async statsFor(tenantId: string, campaignIds: string[]): Promise<Map<string, StatsCore>> {
    const out = new Map<string, StatsCore>();
    if (campaignIds.length === 0) return out;
    for (const id of campaignIds) {
      out.set(id, {
        codesIssued: 0,
        codesRedeemed: 0,
        bookings: 0,
        discountTotal: 0,
        revenueTotal: 0,
        redemptionRate: 0,
      });
    }

    const codes = await this.prisma.propertyPromoCode.findMany({
      where: { tenantId, campaignId: { in: campaignIds } },
      select: { id: true, campaignId: true },
    });
    const campaignOfCode = new Map(codes.map((c) => [c.id, c.campaignId as string]));
    const bookings = codes.length
      ? await this.prisma.booking.findMany({
          where: {
            tenantId,
            promoCodeId: { in: codes.map((c) => c.id) },
            status: { notIn: NOT_COUNTED_STATUSES },
          },
          select: { promoCodeId: true, discountAmount: true, grandTotal: true, totalPrice: true },
        })
      : [];

    for (const c of codes) {
      const s = out.get(c.campaignId as string);
      if (s) out.set(c.campaignId as string, { ...s, codesIssued: s.codesIssued + 1 });
    }
    const redeemed = new Set<string>();
    for (const b of bookings) {
      const campaignId = campaignOfCode.get(b.promoCodeId as string) ?? '';
      const s = out.get(campaignId);
      if (!s) continue;
      const firstUse = !redeemed.has(b.promoCodeId as string);
      redeemed.add(b.promoCodeId as string);
      out.set(campaignId, {
        ...s,
        codesRedeemed: s.codesRedeemed + (firstUse ? 1 : 0),
        bookings: s.bookings + 1,
        discountTotal: round2(s.discountTotal + Number(b.discountAmount ?? 0)),
        revenueTotal: round2(s.revenueTotal + Number(b.grandTotal ?? b.totalPrice ?? 0)),
      });
    }
    for (const [id, s] of out) {
      out.set(id, {
        ...s,
        redemptionRate: s.codesIssued > 0 ? s.codesRedeemed / s.codesIssued : 0,
      });
    }
    return out;
  }

  async statsForCampaign(
    tenantId: string,
    campaign: { id: string; roomPromoCodeId: string | null },
  ): Promise<CampaignRoomPromoStats | null> {
    if (!campaign.roomPromoCodeId) return null;
    const [stats, template] = await Promise.all([
      this.statsFor(tenantId, [campaign.id]),
      this.prisma.propertyPromoCode.findFirst({
        where: { id: campaign.roomPromoCodeId, tenantId },
        select: { code: true },
      }),
    ]);
    return {
      roomPromoCodeId: campaign.roomPromoCodeId,
      templateCode: template?.code ?? null,
      ...(stats.get(campaign.id) as StatsCore),
    };
  }

  private async findForDelivery(
    tenantId: string,
    deliveryId: string,
  ): Promise<IssuedPromoCode | null> {
    const row = await this.prisma.propertyPromoCode.findFirst({
      where: { tenantId, campaignDeliveryId: deliveryId },
      select: { id: true, code: true, validUntil: true },
    });
    return row ? toIssued(row) : null;
  }
}

function toIssued(row: { id: string; code: string; validUntil: Date | null }): IssuedPromoCode {
  return { id: row.id, code: row.code, expiresAt: row.validUntil };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
