import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  RetailPromoCodeKind,
  RetailPromotionRedemptionStatus,
  RetailPromotionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { randomPromoCode } from '../../inventory/retail-promotions/promotion-engine';

/** ช่องทางที่ส่งโค้ดได้จริง — sms/push ยังเป็น stub */
export const PROMO_CAMPAIGN_CHANNELS = ['line', 'email'] as const;

/** ตัวแทนโค้ดในข้อความแคมเปญ — ไม่มีในข้อความ = ต่อท้ายให้อัตโนมัติ */
export const PROMO_CODE_PLACEHOLDER = '{{promoCode}}';
export const PROMO_EXPIRY_PLACEHOLDER = '{{promoExpiresAt}}';

const CODE_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 5;
const DAY_MS = 86_400_000;

export interface IssuedPromoCode {
  id: string;
  code: string;
  expiresAt: Date | null;
}

export type IssueResult = { ok: true; code: IssuedPromoCode } | { ok: false; reason: string };

export interface CampaignPromoStats {
  promotionId: string;
  promotionName: string | null;
  codesIssued: number;
  /** โค้ดที่ถูกใช้แล้ว (นับบิลที่ยังไม่ถูกยกเลิก) */
  codesRedeemed: number;
  discountTotal: number;
  giftCostTotal: number;
  /** codesRedeemed / codesIssued */
  redemptionRate: number;
}

const formatThaiDate = (d: Date): string =>
  d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * ใส่โค้ดลงข้อความแคมเปญ — แทน {{promoCode}} / {{promoExpiresAt}} ถ้ามี
 * ไม่มีตัวแทนโค้ด = ต่อท้ายบรรทัดโค้ดให้ ผู้รับต้องเห็นโค้ดเสมอ
 */
export function renderPromoMessage(body: string | null | undefined, code: string, expiresAt: Date | null): string {
  const expiry = expiresAt ? formatThaiDate(expiresAt) : 'ตามระยะเวลาโปรโมชั่น';
  const base = (body ?? '').trim();
  const rendered = base.split(PROMO_CODE_PLACEHOLDER).join(code).split(PROMO_EXPIRY_PLACEHOLDER).join(expiry);
  if (base.includes(PROMO_CODE_PLACEHOLDER)) return rendered;
  const line = `โค้ดของคุณ: ${code} (ใช้ได้ถึง ${expiry})`;
  return rendered ? `${rendered}\n\n${line}` : line;
}

/** วันหมดอายุของโค้ดที่ออกตอนส่ง: ส่ง + N วัน แต่ไม่เกินวันจบโปร */
export function promoCodeExpiry(now: Date, validDays: number | null, promotionEndsAt: Date | null): Date | null {
  const byDays = validDays ? new Date(now.getTime() + validDays * DAY_MS) : null;
  if (byDays && promotionEndsAt) return byDays < promotionEndsAt ? byDays : promotionEndsAt;
  return byDays ?? promotionEndsAt;
}

/**
 * ออกโค้ดโปร UNIQUE ให้ผู้รับแคมเปญทีละคน
 *
 * 1 delivery = 1 โค้ด (unique campaignDeliveryId) — คิว retry ได้โค้ดเดิม ไม่ออกซ้ำ
 * โค้ดผูก issuedToGuestId → คนอื่นเอาไปใช้ไม่ได้ และ maxUses = 1
 */
@Injectable()
export class CampaignPromoCodeService {
  private readonly logger = new Logger(CampaignPromoCodeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ตรวจตอนสร้าง/แก้แคมเปญ — โปรต้องเป็นของ tenant นี้และยังไม่ถูกเก็บเข้าคลัง */
  async assertLinkable(tenantId: string, promotionId: string, channel: string): Promise<void> {
    if (!(PROMO_CAMPAIGN_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException({
        code: 'PROMO_CAMPAIGN_CHANNEL',
        message: 'แคมเปญแจกโค้ดส่งได้ทาง LINE หรืออีเมลเท่านั้น',
      });
    }
    const promotion = await this.prisma.retailPromotion.findFirst({
      where: { id: promotionId, tenantId },
      select: { status: true, endsAt: true },
    });
    if (!promotion) {
      throw new BadRequestException({ code: 'PROMOTION_NOT_FOUND', message: 'ไม่พบโปรโมชั่นที่เลือก' });
    }
    if (promotion.status === RetailPromotionStatus.ARCHIVED) {
      throw new BadRequestException({ code: 'PROMOTION_ARCHIVED', message: 'โปรโมชั่นนี้ถูกเก็บเข้าคลังแล้ว' });
    }
    if (promotion.endsAt && promotion.endsAt < new Date()) {
      throw new BadRequestException({ code: 'PROMOTION_ENDED', message: 'โปรโมชั่นนี้หมดเขตแล้ว' });
    }
  }

  async issueForDelivery(params: {
    tenantId: string;
    campaignId: string;
    promotionId: string;
    deliveryId: string;
    guestId: string | null;
    validDays: number | null;
  }): Promise<IssueResult> {
    const { tenantId, campaignId, promotionId, deliveryId, guestId } = params;
    if (!guestId) return { ok: false, reason: 'ผู้รับไม่ได้ผูกกับสมาชิก — ออกโค้ดไม่ได้' };

    const existing = await this.findForDelivery(tenantId, deliveryId);
    if (existing) return { ok: true, code: existing };

    const promotion = await this.prisma.retailPromotion.findFirst({
      where: { id: promotionId, tenantId },
      select: { status: true, endsAt: true },
    });
    if (!promotion || promotion.status === RetailPromotionStatus.ARCHIVED) {
      return { ok: false, reason: 'โปรโมชั่นถูกลบหรือเก็บเข้าคลังแล้ว' };
    }
    const now = new Date();
    if (promotion.endsAt && promotion.endsAt < now) return { ok: false, reason: 'โปรโมชั่นหมดเขตแล้ว' };
    const expiresAt = promoCodeExpiry(now, params.validDays, promotion.endsAt);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      try {
        const created = await this.prisma.retailPromoCode.create({
          data: {
            tenantId,
            promotionId,
            code: randomPromoCode(CODE_LENGTH),
            kind: RetailPromoCodeKind.UNIQUE,
            maxUses: 1,
            issuedToGuestId: guestId,
            expiresAt,
            campaignId,
            campaignDeliveryId: deliveryId,
          },
          select: { id: true, code: true, expiresAt: true },
        });
        return { ok: true, code: created };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
        // ชน unique: delivery นี้มีโค้ดแล้ว (job ซ้อน) → ใช้ตัวเดิม · ไม่งั้นโค้ดสุ่มชน → สุ่มใหม่
        const raced = await this.findForDelivery(tenantId, deliveryId);
        if (raced) return { ok: true, code: raced };
      }
    }
    this.logger.error(`issueForDelivery ${deliveryId}: could not generate a unique code`);
    return { ok: false, reason: 'สร้างโค้ดไม่สำเร็จ' };
  }

  /** ส่งไม่สำเร็จ — ปิดโค้ดที่ออกไว้ ไม่ให้ค้างเป็นโค้ดที่ใช้ได้แต่ไม่มีใครได้รับ */
  async revokeForDelivery(tenantId: string, deliveryId: string): Promise<void> {
    await this.prisma.retailPromoCode.updateMany({
      where: { tenantId, campaignDeliveryId: deliveryId, usedCount: 0 },
      data: { isActive: false },
    });
  }

  async statsFor(tenantId: string, campaignIds: string[]): Promise<Map<string, Omit<CampaignPromoStats, 'promotionId' | 'promotionName'>>> {
    const out = new Map<string, Omit<CampaignPromoStats, 'promotionId' | 'promotionName'>>();
    if (campaignIds.length === 0) return out;

    const codes = await this.prisma.retailPromoCode.findMany({
      where: { tenantId, campaignId: { in: campaignIds } },
      select: { id: true, campaignId: true },
    });
    const campaignOfCode = new Map(codes.map((c) => [c.id, c.campaignId as string]));
    const redemptions = codes.length
      ? await this.prisma.retailPromotionRedemption.findMany({
          where: {
            tenantId,
            promoCodeId: { in: codes.map((c) => c.id) },
            status: RetailPromotionRedemptionStatus.APPLIED,
          },
          select: { promoCodeId: true, discountAmount: true, giftCost: true },
        })
      : [];

    for (const id of campaignIds) {
      out.set(id, { codesIssued: 0, codesRedeemed: 0, discountTotal: 0, giftCostTotal: 0, redemptionRate: 0 });
    }
    for (const c of codes) {
      const s = out.get(c.campaignId as string);
      if (s) s.codesIssued += 1;
    }
    const redeemedCodes = new Set<string>();
    for (const r of redemptions) {
      const s = out.get(campaignOfCode.get(r.promoCodeId) ?? '');
      if (!s) continue;
      if (!redeemedCodes.has(r.promoCodeId)) {
        redeemedCodes.add(r.promoCodeId);
        s.codesRedeemed += 1;
      }
      s.discountTotal = round2(s.discountTotal + Number(r.discountAmount));
      s.giftCostTotal = round2(s.giftCostTotal + Number(r.giftCost));
    }
    for (const s of out.values()) {
      s.redemptionRate = s.codesIssued > 0 ? s.codesRedeemed / s.codesIssued : 0;
    }
    return out;
  }

  async statsForCampaign(
    tenantId: string,
    campaign: { id: string; promotionId: string | null },
  ): Promise<CampaignPromoStats | null> {
    if (!campaign.promotionId) return null;
    const [stats, promotion] = await Promise.all([
      this.statsFor(tenantId, [campaign.id]),
      this.prisma.retailPromotion.findFirst({
        where: { id: campaign.promotionId, tenantId },
        select: { name: true },
      }),
    ]);
    return {
      promotionId: campaign.promotionId,
      promotionName: promotion?.name ?? null,
      ...(stats.get(campaign.id) as Omit<CampaignPromoStats, 'promotionId' | 'promotionName'>),
    };
  }

  /** แคมเปญทั้งหมดของโปรหนึ่ง พร้อมยอด sent → redeemed — หน้าโปรโมชั่นใช้ */
  async listForPromotion(tenantId: string, promotionId: string) {
    const campaigns = await this.prisma.crmCampaign.findMany({
      where: { tenantId, promotionId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        scheduledAt: true,
        startedAt: true,
        completedAt: true,
        totalRecipients: true,
        totalSent: true,
        totalFailed: true,
        promoCodeValidDays: true,
        createdAt: true,
      },
    });
    const stats = await this.statsFor(
      tenantId,
      campaigns.map((c) => c.id),
    );
    return campaigns.map((c) => ({ ...c, promo: stats.get(c.id) }));
  }

  private async findForDelivery(tenantId: string, deliveryId: string): Promise<IssuedPromoCode | null> {
    return this.prisma.retailPromoCode.findFirst({
      where: { tenantId, campaignDeliveryId: deliveryId },
      select: { id: true, code: true, expiresAt: true },
    });
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
