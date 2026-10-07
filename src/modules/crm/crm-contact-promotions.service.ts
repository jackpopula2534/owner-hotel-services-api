import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RetailPromotionRedemptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const HISTORY_LIMIT = 100;

export type IssuedCodeState = 'available' | 'used' | 'expired' | 'inactive';

export interface ContactPromoRedemption {
  id: string;
  promotionId: string;
  promotionName: string;
  code: string;
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
}

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
    };
    if (!contact.guestId) return empty;
    const guestId = contact.guestId;

    const [redemptionRows, codeRows] = await Promise.all([
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
        code: r.code,
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
    return {
      ...empty,
      summary: {
        redeemed: applied.length,
        reversed: redemptions.length - applied.length,
        discountTotal: round2(applied.reduce((s, r) => s + r.discountAmount, 0)),
        giftCostTotal: round2(applied.reduce((s, r) => s + r.giftCost, 0)),
        salesTotal: round2(applied.reduce((s, r) => s + (r.sale?.grandTotal ?? 0), 0)),
        codesIssued: issuedCodes.length,
        codesAvailable: issuedCodes.filter((c) => c.state === 'available').length,
      },
      redemptions,
      issuedCodes,
    };
  }
}
