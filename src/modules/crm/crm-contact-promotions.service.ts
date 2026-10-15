import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RetailPromotionRedemptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const HISTORY_LIMIT = 100;

export type IssuedCodeState = 'available' | 'used' | 'expired' | 'inactive';

export interface ContactPromoRedemption {
  id: string;
  promotionId: string;
  promotionName: string;
  /** null = โปรอัตโนมัติ (ไม่ใช้โค้ด) */
  code: string | null;
  autoApplied: boolean;
  status: RetailPromotionRedemptionStatus;
  discountAmount: number;
  giftCost: number;
  giftSkipped: boolean;
  redeemedAt: Date;
  reversedAt: Date | null;
  sale: { id: string; receiptNo: string; grandTotal: number } | null;
}

export interface ContactIssuedCode {
  id: string;
  code: string;
  promotionId: string;
  promotionName: string;
  campaignId: string | null;
  campaignName: string | null;
  state: IssuedCodeState;
  expiresAt: Date | null;
  issuedAt: Date;
}

/** การจองห้องพักที่ใช้โค้ดส่วนลดของโรงแรม */
export interface ContactRoomPromoBooking {
  id: string;
  bookingNo: string | null;
  code: string | null;
  /** โค้ดเฉพาะคนที่แคมเปญ CRM ออกให้ */
  fromCampaign: boolean;
  status: string;
  checkIn: Date;
  checkOut: Date;
  discountAmount: number;
  total: number;
  bookedAt: Date;
}

/** โค้ดส่วนลดห้องพักเฉพาะคนที่แคมเปญออกให้ */
export interface ContactRoomIssuedCode {
  id: string;
  code: string;
  templateCode: string | null;
  campaignId: string | null;
  campaignName: string | null;
  state: IssuedCodeState;
  validUntil: string | null;
  issuedAt: Date;
}

export interface ContactRoomPromoHistory {
  summary: {
    bookings: number;
    discountTotal: number;
    /** ยอดการจองที่ใช้โค้ด (ไม่นับที่ยกเลิก) */
    bookingsTotal: number;
    codesIssued: number;
    codesAvailable: number;
  };
  bookings: ContactRoomPromoBooking[];
  issuedCodes: ContactRoomIssuedCode[];
}

export interface ContactPromoHistory {
  contactId: string;
  guestId: string | null;
  summary: {
    redeemed: number;
    reversed: number;
    discountTotal: number;
    giftCostTotal: number;
    /** ยอดบิลที่ใช้โปร (ไม่นับบิลที่ยกเลิก) */
    salesTotal: number;
    codesIssued: number;
    codesAvailable: number;
  };
  redemptions: ContactPromoRedemption[];
  issuedCodes: ContactIssuedCode[];
  /** โปรห้องพัก (โค้ดส่วนลดของโรงแรมที่ใช้ตอนจอง) */
  room: ContactRoomPromoHistory;
}

const ROOM_NOT_COUNTED = 'cancelled';
const bangkokToday = (now: Date): string =>
  new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
const toYmd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function issuedCodeState(
  code: { isActive: boolean; usedCount: number; maxUses: number | null; expiresAt: Date | null },
  now: Date,
): IssuedCodeState {
  if (code.maxUses != null && code.usedCount >= code.maxUses) return 'used';
  if (!code.isActive) return 'inactive';
  if (code.expiresAt && code.expiresAt < now) return 'expired';
  return 'available';
}

/**
 * Contact 360 — ประวัติโปรโมชั่นร้านค้าของสมาชิก: บิลที่ใช้โค้ด + โค้ดที่ออกให้ (จากแคมเปญ/แอดมิน)
 * อ่านจากตารางโปรโดยตรงด้วย guestId ของ contact — ไม่มีสำเนาข้อมูลใน CRM
 */
@Injectable()
export class CrmContactPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async history(contactId: string, tenantId: string): Promise<ContactPromoHistory> {
    const contact = await this.prisma.crmContact.findFirst({
      where: { id: contactId, tenantId },
      select: { id: true, guestId: true },
    });
    if (!contact) throw new NotFoundException(`Contact ${contactId} not found`);

    const empty: ContactPromoHistory = {
      contactId: contact.id,
      guestId: contact.guestId,
      summary: {
        redeemed: 0,
        reversed: 0,
        discountTotal: 0,
        giftCostTotal: 0,
        salesTotal: 0,
        codesIssued: 0,
        codesAvailable: 0,
      },
      redemptions: [],
      issuedCodes: [],
      room: {
        summary: { bookings: 0, discountTotal: 0, bookingsTotal: 0, codesIssued: 0, codesAvailable: 0 },
        bookings: [],
        issuedCodes: [],
      },
    };
    if (!contact.guestId) return empty;
    const guestId = contact.guestId;

    const [redemptionRows, codeRows, room] = await Promise.all([
      this.prisma.retailPromotionRedemption.findMany({
        where: { tenantId, guestId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { promotion: { select: { name: true } } },
      }),
      this.prisma.retailPromoCode.findMany({
        where: { tenantId, issuedToGuestId: guestId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        include: { promotion: { select: { name: true } } },
      }),
      this.roomHistory(tenantId, guestId),
    ]);

    const saleIds = redemptionRows.map((r) => r.saleId);
    const campaignIds = [...new Set(codeRows.map((c) => c.campaignId).filter((id): id is string => !!id))];
    type SaleRow = { id: string; receiptNo: string; grandTotal: Prisma.Decimal };
    type CampaignRow = { id: string; name: string };
    const [sales, campaigns] = await Promise.all([
      saleIds.length
        ? this.prisma.retailSale.findMany({
            where: { tenantId, id: { in: saleIds } },
            select: { id: true, receiptNo: true, grandTotal: true },
          })
        : Promise.resolve<SaleRow[]>([]),
      campaignIds.length
        ? this.prisma.crmCampaign.findMany({
            where: { tenantId, id: { in: campaignIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve<CampaignRow[]>([]),
    ]);
    const saleById = new Map<string, SaleRow>(sales.map((s) => [s.id, s]));
    const campaignName = new Map<string, string>(campaigns.map((c) => [c.id, c.name]));

    const redemptions = redemptionRows.map<ContactPromoRedemption>((r) => {
      const sale = saleById.get(r.saleId);
      return {
        id: r.id,
        promotionId: r.promotionId,
        promotionName: r.promotion?.name ?? '—',
        code: r.code ?? null,
        autoApplied: !r.promoCodeId,
        status: r.status,
        discountAmount: Number(r.discountAmount),
        giftCost: Number(r.giftCost),
        giftSkipped: r.giftSkipped,
        redeemedAt: r.createdAt,
        reversedAt: r.reversedAt,
        sale: sale ? { id: sale.id, receiptNo: sale.receiptNo, grandTotal: Number(sale.grandTotal) } : null,
      };
    });

    const now = new Date();
    const issuedCodes = codeRows.map<ContactIssuedCode>((c) => ({
      id: c.id,
      code: c.code,
      promotionId: c.promotionId,
      promotionName: c.promotion?.name ?? '—',
      campaignId: c.campaignId,
      campaignName: c.campaignId ? (campaignName.get(c.campaignId) ?? null) : null,
      state: issuedCodeState(c, now),
      expiresAt: c.expiresAt,
      issuedAt: c.createdAt,
    }));

    const applied = redemptions.filter((r) => r.status === RetailPromotionRedemptionStatus.APPLIED);
    // บิลเดียวมีได้หลายโปร (โค้ด + โปรอัตโนมัติ) → นับบิล/ยอดบิลไม่ซ้ำ
    const appliedSales = new Map(applied.map((r) => [r.sale?.id ?? r.id, r.sale?.grandTotal ?? 0]));
    const reversedSales = new Set(
      redemptions.filter((r) => r.status !== RetailPromotionRedemptionStatus.APPLIED).map((r) => r.sale?.id ?? r.id),
    );
    return {
      ...empty,
      summary: {
        redeemed: appliedSales.size,
        reversed: reversedSales.size,
        discountTotal: round2(applied.reduce((s, r) => s + r.discountAmount, 0)),
        giftCostTotal: round2(applied.reduce((s, r) => s + r.giftCost, 0)),
        salesTotal: round2([...appliedSales.values()].reduce((s, v) => s + v, 0)),
        codesIssued: issuedCodes.length,
        codesAvailable: issuedCodes.filter((c) => c.state === 'available').length,
      },
      redemptions,
      issuedCodes,
      room,
    };
  }

  /** โค้ดส่วนลดห้องพัก: การจองที่ใช้โค้ด + โค้ดเฉพาะคนที่แคมเปญ CRM ออกให้ */
  private async roomHistory(tenantId: string, guestId: string): Promise<ContactRoomPromoHistory> {
    const [bookingRows, codeRows] = await Promise.all([
      this.prisma.booking.findMany({
        where: { tenantId, guestId, promoCodeId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
        select: {
          id: true,
          bookingNo: true,
          promoCodeId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          discountAmount: true,
          grandTotal: true,
          totalPrice: true,
          createdAt: true,
        },
      }),
      this.prisma.propertyPromoCode.findMany({
        where: { tenantId, issuedToGuestId: guestId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_LIMIT,
      }),
    ]);

    // โค้ดที่การจองใช้ + โค้ดต้นแบบของโค้ดเฉพาะคน + การจองที่ใช้โค้ดเฉพาะคน (นับสถานะ "ใช้แล้ว")
    const issuedIds = codeRows.map((c) => c.id);
    const lookupIds = [
      ...new Set([
        ...bookingRows.map((b) => b.promoCodeId as string),
        ...codeRows.map((c) => c.parentId).filter((id): id is string => !!id),
      ]),
    ].filter((id) => !issuedIds.includes(id));
    const campaignIds = [...new Set(codeRows.map((c) => c.campaignId).filter((id): id is string => !!id))];
    type CodeRow = { id: string; code: string; parentId: string | null };
    type CampaignRow = { id: string; name: string };
    type UseRow = { promoCodeId: string | null };
    const [lookups, campaigns, uses] = await Promise.all([
      lookupIds.length
        ? this.prisma.propertyPromoCode.findMany({
            where: { tenantId, id: { in: lookupIds } },
            select: { id: true, code: true, parentId: true },
          })
        : Promise.resolve<CodeRow[]>([]),
      campaignIds.length
        ? this.prisma.crmCampaign.findMany({
            where: { tenantId, id: { in: campaignIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve<CampaignRow[]>([]),
      issuedIds.length
        ? this.prisma.booking.findMany({
            where: { tenantId, promoCodeId: { in: issuedIds }, status: { not: ROOM_NOT_COUNTED } },
            select: { promoCodeId: true },
          })
        : Promise.resolve<UseRow[]>([]),
    ]);
    const codeById = new Map<string, CodeRow>([
      ...codeRows.map((c): [string, CodeRow] => [c.id, c]),
      ...lookups.map((c): [string, CodeRow] => [c.id, c]),
    ]);
    const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
    const usedIds = new Set(uses.map((u) => u.promoCodeId as string));

    const bookings = bookingRows.map<ContactRoomPromoBooking>((b) => {
      const code = codeById.get(b.promoCodeId as string);
      return {
        id: b.id,
        bookingNo: b.bookingNo,
        code: code?.code ?? null,
        fromCampaign: !!code?.parentId,
        status: b.status,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        discountAmount: Number(b.discountAmount ?? 0),
        total: Number(b.grandTotal ?? b.totalPrice ?? 0),
        bookedAt: b.createdAt,
      };
    });

    const today = bangkokToday(new Date());
    const issuedCodes = codeRows.map<ContactRoomIssuedCode>((c) => {
      const validUntil = toYmd(c.validUntil);
      const state: IssuedCodeState = usedIds.has(c.id)
        ? 'used'
        : !c.isActive
          ? 'inactive'
          : validUntil && validUntil < today
            ? 'expired'
            : 'available';
      return {
        id: c.id,
        code: c.code,
        templateCode: c.parentId ? (codeById.get(c.parentId)?.code ?? null) : null,
        campaignId: c.campaignId,
        campaignName: c.campaignId ? (campaignName.get(c.campaignId) ?? null) : null,
        state,
        validUntil,
        issuedAt: c.createdAt,
      };
    });

    const counted = bookings.filter((b) => b.status !== ROOM_NOT_COUNTED);
    return {
      summary: {
        bookings: counted.length,
        discountTotal: round2(counted.reduce((s, b) => s + b.discountAmount, 0)),
        bookingsTotal: round2(counted.reduce((s, b) => s + b.total, 0)),
        codesIssued: issuedCodes.length,
        codesAvailable: issuedCodes.filter((c) => c.state === 'available').length,
      },
      bookings,
      issuedCodes,
    };
  }
}
