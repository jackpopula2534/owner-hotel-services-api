import { randomBytes } from 'crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RetailPromoCodeKind,
  RetailPromoDiscountType,
  RetailPromotionRedemptionStatus,
  RetailPromotionStatus,
  WarehouseType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  computePromoDiscount,
  jsonStringList,
  normalizeCode,
  promoError,
  PromoCartLine,
  round2,
} from './promotion-engine';
import {
  CreatePromoCodeDto,
  CreateRetailPromotionDto,
  GeneratePromoCodesDto,
  PreviewPromotionDto,
  RegisterMemberDto,
  UpdatePromoCodeDto,
  UpdateRetailPromotionDto,
} from './dto/retail-promotion.dto';

/** Either the root client or an interactive-transaction client. */
type Db = Prisma.TransactionClient;

/** ไม่มี 0/O/1/I — แคชเชียร์อ่านโค้ดจากจอลูกค้าแล้วพิมพ์ไม่พลาด */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** PDPA consent version recorded when a member signs up at the POS. */
const POS_CONSENT_VERSION = '1.0';

export interface PromoMember {
  guestId: string;
  name: string;
  phone: string | null;
  email: string | null;
  tier: string;
  segment: string | null;
  contactId: string | null;
}

export interface EvaluatedGift {
  giftId: string;
  itemId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  budgetQty: number | null;
  /** ชิ้นที่แจกได้ตอนนี้ = min(สต็อกคลังของแถม, งบที่เหลือ) */
  availableQty: number;
}

export interface EvaluatedPromotion {
  promotion: {
    id: string;
    name: string;
    discountType: RetailPromoDiscountType;
    discountValue: number;
    maxDiscount: number | null;
    minSpend: number;
    usageLimit: number | null;
    perMemberLimit: number | null;
    giftWarehouseId: string | null;
  };
  code: { id: string; code: string; maxUses: number | null };
  member: PromoMember;
  netSubtotal: number;
  discount: number;
  gifts: EvaluatedGift[];
}

@Injectable()
export class RetailPromotionsService {
  private readonly logger = new Logger(RetailPromotionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── Promotions CRUD ─────────────────────────────

  async list(tenantId: string, query: { status?: string; search?: string }) {
    const where: Prisma.RetailPromotionWhereInput = { tenantId };
    if (query.status && query.status in RetailPromotionStatus) {
      where.status = query.status as RetailPromotionStatus;
    } else {
      where.status = { not: RetailPromotionStatus.ARCHIVED };
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [{ name: { contains: term } }, { codes: { some: { code: { contains: term.toUpperCase() } } } }];
    }
    const rows = await this.prisma.retailPromotion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        gifts: true,
        _count: { select: { codes: true, redemptions: true } },
      },
    });
    const items = await this.itemNames(
      tenantId,
      rows.flatMap((r) => r.gifts.map((g) => g.itemId)),
    );
    return rows.map((r) => ({
      ...this.toPromotion(r),
      codeCount: r._count.codes,
      redemptionCount: r._count.redemptions,
      gifts: r.gifts.map((g) => this.toGift(g, items)),
    }));
  }

  async findOne(id: string, tenantId: string) {
    const promo = await this.prisma.retailPromotion.findFirst({
      where: { id, tenantId },
      include: {
        gifts: true,
        codes: { orderBy: { createdAt: 'desc' }, take: 500 },
      },
    });
    if (!promo) throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'ไม่พบโปรโมชั่นนี้' });

    const items = await this.itemNames(tenantId, promo.gifts.map((g) => g.itemId));
    const stock = promo.giftWarehouseId
      ? await this.giftStock(this.prisma, promo.giftWarehouseId, promo.gifts.map((g) => g.itemId))
      : new Map<string, number>();
    const [summary] = await this.prisma.retailPromotionRedemption.groupBy({
      by: ['promotionId'],
      where: { tenantId, promotionId: id, status: 'APPLIED' },
      _sum: { discountAmount: true, giftCost: true },
      _count: { _all: true },
    }).then((r) => (r.length ? r : [null]));

    return {
      ...this.toPromotion(promo),
      gifts: promo.gifts.map((g) => ({
        ...this.toGift(g, items),
        warehouseQty: stock.get(g.itemId) ?? 0,
      })),
      codes: promo.codes.map((c) => ({
        id: c.id,
        code: c.code,
        kind: c.kind,
        maxUses: c.maxUses,
        usedCount: c.usedCount,
        isActive: c.isActive,
        issuedToGuestId: c.issuedToGuestId,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
      stats: {
        redemptions: summary?._count._all ?? 0,
        discountTotal: Number(summary?._sum.discountAmount ?? 0),
        giftCostTotal: Number(summary?._sum.giftCost ?? 0),
      },
    };
  }

  async create(dto: CreateRetailPromotionDto, tenantId: string, userId: string) {
    const gifts = dto.gifts ?? [];
    await this.validatePromotion(tenantId, {
      discountType: dto.discountType,
      discountValue: dto.discountValue ?? 0,
      giftWarehouseId: dto.giftWarehouseId ?? null,
      giftItemIds: gifts.map((g) => g.itemId),
      eligibleItemIds: dto.eligibleItemIds ?? [],
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
    });

    const created = await this.prisma.retailPromotion.create({
      data: {
        tenantId,
        ...this.promotionData(dto),
        createdBy: userId,
        gifts: {
          create: gifts.map((g) => ({
            tenantId,
            itemId: g.itemId,
            quantity: g.quantity,
            budgetQty: g.budgetQty ?? null,
          })),
        },
      },
    });
    this.logger.log(`Retail promotion ${created.id} created (tenant ${tenantId})`);
    return this.findOne(created.id, tenantId);
  }

  async update(id: string, dto: UpdateRetailPromotionDto, tenantId: string) {
    const current = await this.prisma.retailPromotion.findFirst({
      where: { id, tenantId },
      include: { gifts: true },
    });
    if (!current) throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'ไม่พบโปรโมชั่นนี้' });

    const gifts = dto.gifts ?? current.gifts.map((g) => ({ itemId: g.itemId, quantity: g.quantity, budgetQty: g.budgetQty }));
    await this.validatePromotion(tenantId, {
      discountType: dto.discountType ?? current.discountType,
      discountValue: dto.discountValue ?? Number(current.discountValue),
      giftWarehouseId: dto.giftWarehouseId !== undefined ? dto.giftWarehouseId : current.giftWarehouseId,
      giftItemIds: gifts.map((g) => g.itemId),
      eligibleItemIds: dto.eligibleItemIds ?? jsonStringList(current.eligibleItemIds),
      startsAt: dto.startsAt !== undefined ? dto.startsAt : current.startsAt?.toISOString() ?? null,
      endsAt: dto.endsAt !== undefined ? dto.endsAt : current.endsAt?.toISOString() ?? null,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.retailPromotion.update({ where: { id }, data: this.promotionData(dto) });
      if (dto.gifts) {
        // แทนที่ทั้งชุด แต่เก็บ issuedQty ของรายการเดิมไว้ — ไม่งั้นงบของแถมรีเซ็ตทุกครั้งที่แก้
        const keep = new Set(dto.gifts.map((g) => g.itemId));
        await tx.retailPromotionGift.deleteMany({
          where: { tenantId, promotionId: id, itemId: { notIn: [...keep] } },
        });
        for (const g of dto.gifts) {
          await tx.retailPromotionGift.upsert({
            where: { promotionId_itemId: { promotionId: id, itemId: g.itemId } },
            create: { tenantId, promotionId: id, itemId: g.itemId, quantity: g.quantity, budgetQty: g.budgetQty ?? null },
            update: { quantity: g.quantity, budgetQty: g.budgetQty ?? null },
          });
        }
      }
    });
    return this.findOne(id, tenantId);
  }

  // ───────────────────────────────── Codes ──────────────────────────────────

  async addCode(promotionId: string, dto: CreatePromoCodeDto, tenantId: string) {
    await this.requirePromotion(promotionId, tenantId);
    if (dto.issuedToGuestId) await this.requireGuest(this.prisma, tenantId, dto.issuedToGuestId);
    try {
      const code = await this.prisma.retailPromoCode.create({
        data: {
          tenantId,
          promotionId,
          code: normalizeCode(dto.code),
          kind: dto.issuedToGuestId ? RetailPromoCodeKind.UNIQUE : RetailPromoCodeKind.SHARED,
          maxUses: dto.maxUses ?? null,
          issuedToGuestId: dto.issuedToGuestId ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
      return code;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'PROMO_CODE_TAKEN',
          message: `โค้ด ${normalizeCode(dto.code)} ถูกใช้ไปแล้วในโปรอื่น`,
        });
      }
      throw err;
    }
  }

  async generateCodes(promotionId: string, dto: GeneratePromoCodesDto, tenantId: string) {
    await this.requirePromotion(promotionId, tenantId);
    const prefix = dto.prefix ? `${dto.prefix.toUpperCase()}-` : '';
    const created: string[] = [];
    // ชนกับโค้ดเดิมได้ (น้อยมาก) — createMany skipDuplicates แล้วสุ่มเติมจนครบ
    for (let attempt = 0; attempt < 5 && created.length < dto.count; attempt++) {
      const batch = Array.from({ length: dto.count - created.length }, () => prefix + this.randomCode(8));
      await this.prisma.retailPromoCode.createMany({
        data: batch.map((code) => ({
          tenantId,
          promotionId,
          code,
          kind: RetailPromoCodeKind.UNIQUE,
          maxUses: dto.maxUses ?? 1,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        })),
        skipDuplicates: true,
      });
      const stored = await this.prisma.retailPromoCode.findMany({
        where: { tenantId, promotionId, code: { in: batch } },
        select: { code: true },
      });
      created.push(...stored.map((s) => s.code));
    }
    return { count: created.length, codes: created };
  }

  async updateCode(codeId: string, dto: UpdatePromoCodeDto, tenantId: string) {
    const found = await this.prisma.retailPromoCode.findFirst({ where: { id: codeId, tenantId } });
    if (!found) throw new NotFoundException({ code: 'PROMO_CODE_NOT_FOUND', message: 'ไม่พบโค้ดนี้' });
    return this.prisma.retailPromoCode.update({ where: { id: codeId }, data: { isActive: dto.isActive } });
  }

  // ──────────────────────────────── Members ─────────────────────────────────
  // สมาชิก = Guest ของระบบหลัก + CrmContact + LoyaltyPoint เดิม — ไม่มีตารางสมาชิกแยก

  async searchMembers(tenantId: string, search: string): Promise<PromoMember[]> {
    const term = (search ?? '').trim();
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, '');
    const parts = term.split(/\s+/);
    const or: Prisma.GuestWhereInput[] = [
      { firstName: { contains: term } },
      { lastName: { contains: term } },
      { email: { contains: term } },
    ];
    if (digits.length >= 3) or.push({ phone: { contains: digits } });
    if (parts.length >= 2) {
      or.push({ AND: [{ firstName: { contains: parts[0] } }, { lastName: { contains: parts.slice(1).join(' ') } }] });
    }
    const guests = await this.prisma.guest.findMany({
      where: { tenantId, anonymizedAt: null, OR: or },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });
    return this.decorateMembers(this.prisma, tenantId, guests);
  }

  async getMember(tenantId: string, guestId: string): Promise<PromoMember> {
    return this.resolveMember(this.prisma, tenantId, guestId);
  }

  async registerMember(tenantId: string, dto: RegisterMemberDto, ipAddress?: string): Promise<PromoMember> {
    const phone = dto.phone.replace(/[\s-]/g, '');
    const existing = await this.prisma.guest.findFirst({
      where: { tenantId, phone, anonymizedAt: null },
    });
    if (existing) {
      throw new ConflictException({
        code: 'MEMBER_PHONE_EXISTS',
        message: `เบอร์ ${phone} เป็นสมาชิกอยู่แล้ว (${existing.firstName} ${existing.lastName})`,
        details: { guestId: existing.id },
      });
    }
    const guest = await this.prisma.$transaction(async (tx) => {
      const created = await tx.guest.create({
        data: {
          tenantId,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone,
          email: dto.email?.trim() || null,
          consentGiven: true,
          consentAt: new Date(),
          consentVersion: POS_CONSENT_VERSION,
          consentIpAddress: ipAddress?.slice(0, 45) ?? null,
        },
      });
      await this.ensureContact(tx, tenantId, created.id);
      return created;
    });
    this.logger.log(`Member (guest ${guest.id}) registered at POS (tenant ${tenantId})`);
    return this.resolveMember(this.prisma, tenantId, guest.id);
  }

  /**
   * Validate a member belongs to this tenant and load tier/segment. Used by the
   * checkout transaction as well, so it accepts a transaction client.
   */
  async resolveMember(db: Db, tenantId: string, guestId: string): Promise<PromoMember> {
    const guest = await this.requireGuest(db, tenantId, guestId);
    const [member] = await this.decorateMembers(db, tenantId, [guest]);
    return member;
  }

  /** Idempotent on (tenantId, guestId) — the CRM profile of a member. */
  async ensureContact(db: Db, tenantId: string, guestId: string): Promise<string> {
    const contact = await db.crmContact.upsert({
      where: { tenantId_guestId: { tenantId, guestId } },
      create: { tenantId, guestId, segment: 'new' },
      update: {},
      select: { id: true },
    });
    return contact.id;
  }

  // ────────────────────────────── Evaluation ────────────────────────────────

  async preview(dto: PreviewPromotionDto, tenantId: string) {
    const evaluated = await this.evaluate(this.prisma, tenantId, {
      code: dto.code,
      guestId: dto.memberGuestId,
      lines: dto.lines,
    });
    const shortGifts = evaluated.gifts.filter((g) => g.availableQty < g.quantity);
    return {
      ...evaluated,
      giftShortage: shortGifts.length > 0,
      // ลูกค้าเลือก "รับเฉพาะส่วนลด" ได้ก็ต่อเมื่อยังเหลือประโยชน์บางอย่างหลังตัดของแถมที่ขาด
      canAcceptWithoutGift:
        shortGifts.length > 0 &&
        (evaluated.discount > 0 || evaluated.gifts.some((g) => g.availableQty >= g.quantity)),
    };
  }

  /**
   * Check a code against the cart and member, and price it. Runs inside the
   * checkout transaction too (`db` = tx) so the sale is priced on the same
   * snapshot it commits — the client's preview numbers are never trusted.
   */
  async evaluate(
    db: Db,
    tenantId: string,
    input: { code: string; guestId?: string | null; lines: PromoCartLine[] },
  ): Promise<EvaluatedPromotion> {
    if (!input.guestId) {
      throw promoError('PROMO_MEMBER_REQUIRED', 'ต้องเลือกสมาชิกก่อนใช้โค้ดโปรโมชั่น');
    }
    const codeText = normalizeCode(input.code);
    const code = await db.retailPromoCode.findFirst({
      where: { tenantId, code: codeText },
      include: { promotion: { include: { gifts: true } } },
    });
    if (!code) throw promoError('PROMO_CODE_NOT_FOUND', `ไม่พบโค้ด ${codeText}`);

    const now = new Date();
    const promo = code.promotion;
    if (!code.isActive) throw promoError('PROMO_CODE_INACTIVE', 'โค้ดนี้ถูกปิดใช้งานแล้ว');
    if (code.expiresAt && code.expiresAt < now) throw promoError('PROMO_CODE_EXPIRED', 'โค้ดนี้หมดอายุแล้ว');
    if (code.maxUses != null && code.usedCount >= code.maxUses) {
      throw promoError('PROMO_CODE_USED_UP', 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว');
    }
    if (promo.status !== RetailPromotionStatus.ACTIVE) {
      throw promoError('PROMO_NOT_ACTIVE', `โปรโมชั่น "${promo.name}" ยังไม่เปิดใช้งาน`);
    }
    if (promo.startsAt && promo.startsAt > now) {
      throw promoError('PROMO_NOT_STARTED', `โปรโมชั่น "${promo.name}" ยังไม่เริ่ม`);
    }
    if (promo.endsAt && promo.endsAt < now) {
      throw promoError('PROMO_EXPIRED', `โปรโมชั่น "${promo.name}" สิ้นสุดแล้ว`);
    }
    if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) {
      throw promoError('PROMO_SOLD_OUT', `โปรโมชั่น "${promo.name}" ถูกใช้ครบโควตาแล้ว`);
    }

    const member = await this.resolveMember(db, tenantId, input.guestId);
    if (code.issuedToGuestId && code.issuedToGuestId !== member.guestId) {
      throw promoError('PROMO_CODE_NOT_YOURS', 'โค้ดนี้ออกให้สมาชิกท่านอื่น');
    }
    const tiers = jsonStringList(promo.eligibleTiers);
    if (tiers.length && !tiers.includes(member.tier)) {
      throw promoError('PROMO_TIER_NOT_ELIGIBLE', `โปรนี้สำหรับสมาชิกระดับ ${tiers.join(', ')} เท่านั้น`, {
        tier: member.tier,
      });
    }
    const segments = jsonStringList(promo.eligibleSegments);
    if (segments.length && (!member.segment || !segments.includes(member.segment))) {
      throw promoError('PROMO_SEGMENT_NOT_ELIGIBLE', 'สมาชิกท่านนี้ไม่อยู่ในกลุ่มเป้าหมายของโปรนี้');
    }
    if (promo.perMemberLimit != null) {
      const usage = await db.retailPromotionMemberUsage.findFirst({
        where: { tenantId, promotionId: promo.id, guestId: member.guestId },
      });
      if ((usage?.usedCount ?? 0) >= promo.perMemberLimit) {
        throw promoError('PROMO_MEMBER_LIMIT', `สมาชิกท่านนี้ใช้โปรนี้ครบ ${promo.perMemberLimit} ครั้งแล้ว`);
      }
    }

    const priced = computePromoDiscount(
      {
        discountType: promo.discountType,
        discountValue: Number(promo.discountValue),
        maxDiscount: promo.maxDiscount != null ? Number(promo.maxDiscount) : null,
        minSpend: Number(promo.minSpend),
        eligibleItemIds: jsonStringList(promo.eligibleItemIds),
      },
      input.lines,
    );

    const giftIds = promo.gifts.map((g) => g.itemId);
    const [items, stock] = await Promise.all([
      this.itemNames(tenantId, giftIds, db),
      promo.giftWarehouseId ? this.giftStock(db, promo.giftWarehouseId, giftIds) : Promise.resolve(new Map<string, number>()),
    ]);
    const gifts: EvaluatedGift[] = promo.gifts.map((g) => {
      const item = items.get(g.itemId);
      const budgetLeft = g.budgetQty != null ? Math.max(g.budgetQty - g.issuedQty, 0) : Infinity;
      return {
        giftId: g.id,
        itemId: g.itemId,
        name: item?.name ?? 'ของแถม',
        sku: item?.sku ?? '',
        unit: item?.unit ?? 'ชิ้น',
        quantity: g.quantity,
        budgetQty: g.budgetQty,
        availableQty: Math.floor(Math.min(stock.get(g.itemId) ?? 0, budgetLeft)),
      };
    });

    return {
      promotion: {
        id: promo.id,
        name: promo.name,
        discountType: promo.discountType,
        discountValue: Number(promo.discountValue),
        maxDiscount: promo.maxDiscount != null ? Number(promo.maxDiscount) : null,
        minSpend: Number(promo.minSpend),
        usageLimit: promo.usageLimit,
        perMemberLimit: promo.perMemberLimit,
        giftWarehouseId: promo.giftWarehouseId,
      },
      code: { id: code.id, code: code.code, maxUses: code.maxUses },
      member,
      netSubtotal: priced.netSubtotal,
      discount: priced.discount,
      gifts,
    };
  }

  /**
   * Consume every quota the redemption touches and write the redemption row.
   * Each counter is a conditional increment (`usedCount < limit`), so two tills
   * racing for the last use cannot both win — the loser's whole sale rolls back.
   */
  async recordRedemptionWithin(
    tx: Db,
    params: {
      tenantId: string;
      userId: string;
      saleId: string;
      evaluated: EvaluatedPromotion;
      grantedGifts: EvaluatedGift[];
      giftSkipped: boolean;
      giftCost: number;
      contactId: string | null;
    },
  ): Promise<void> {
    const { tenantId, evaluated, grantedGifts } = params;
    const { promotion, code, member } = evaluated;

    await this.incrementWithin(
      () =>
        tx.retailPromotion.updateMany({
          where: {
            id: promotion.id,
            tenantId,
            ...(promotion.usageLimit != null ? { usedCount: { lt: promotion.usageLimit } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        }),
      'PROMO_SOLD_OUT',
      'โปรโมชั่นนี้ถูกใช้ครบโควตาแล้ว',
    );
    await this.incrementWithin(
      () =>
        tx.retailPromoCode.updateMany({
          where: {
            id: code.id,
            tenantId,
            isActive: true,
            ...(code.maxUses != null ? { usedCount: { lt: code.maxUses } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        }),
      'PROMO_CODE_USED_UP',
      'โค้ดนี้ถูกใช้ครบจำนวนแล้ว',
    );

    await tx.retailPromotionMemberUsage.upsert({
      where: { promotionId_guestId: { promotionId: promotion.id, guestId: member.guestId } },
      create: { tenantId, promotionId: promotion.id, guestId: member.guestId, usedCount: 0 },
      update: {},
    });
    await this.incrementWithin(
      () =>
        tx.retailPromotionMemberUsage.updateMany({
          where: {
            tenantId,
            promotionId: promotion.id,
            guestId: member.guestId,
            ...(promotion.perMemberLimit != null ? { usedCount: { lt: promotion.perMemberLimit } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        }),
      'PROMO_MEMBER_LIMIT',
      'สมาชิกท่านนี้ใช้โปรนี้ครบจำนวนแล้ว',
    );

    for (const gift of grantedGifts) {
      await this.incrementWithin(
        () =>
          tx.retailPromotionGift.updateMany({
            where: {
              id: gift.giftId,
              tenantId,
              ...(gift.budgetQty != null ? { issuedQty: { lte: gift.budgetQty - gift.quantity } } : {}),
            },
            data: { issuedQty: { increment: gift.quantity } },
          }),
        'PROMO_GIFT_SHORTAGE',
        `งบของแถม "${gift.name}" หมดแล้ว`,
      );
    }

    await tx.retailPromotionRedemption.create({
      data: {
        tenantId,
        promotionId: promotion.id,
        promoCodeId: code.id,
        code: code.code,
        saleId: params.saleId,
        guestId: member.guestId,
        contactId: params.contactId,
        discountAmount: round2(evaluated.discount),
        giftCost: round2(params.giftCost),
        giftSkipped: params.giftSkipped,
        redeemedBy: params.userId,
      },
    });
  }

  // ──────────────────────────────── Helpers ─────────────────────────────────

  /**
   * บิลถูก void — คืนสิทธิ์ทุกตัวนับที่ {@link recordRedemptionWithin} กินไป
   * (โควตาโปร โค้ด ต่อสมาชิก งบของแถม) แล้วตี redemption เป็น REVERSED
   *
   * จำนวนของแถมที่คืนงบอ่านจากบรรทัดของแถมของใบเสร็จจริง ไม่ใช่จากตั้งค่าโปรปัจจุบัน
   * — แอดมินแก้จำนวนแจกหลังขายไปแล้วได้ ถ้าคืนตามค่าใหม่ issuedQty จะเพี้ยน
   * ตัวนับลดแบบมีเงื่อนไข `> 0` ไม่มีทางติดลบ แม้ข้อมูลเก่าจะไม่ตรง
   *
   * ไม่มี redemption ที่ยัง APPLIED = คืน null (บิลไม่ได้ใช้โค้ด / ถูกคืนไปแล้ว)
   */
  async reverseRedemptionWithin(
    tx: Db,
    params: {
      tenantId: string;
      saleId: string;
      giftLines: Array<{ itemId: string; quantity: number }>;
    },
  ): Promise<{ redemptionId: string; promotionId: string } | null> {
    const { tenantId, saleId, giftLines } = params;
    const redemption = await tx.retailPromotionRedemption.findFirst({
      where: { tenantId, saleId, status: RetailPromotionRedemptionStatus.APPLIED },
    });
    if (!redemption) return null;

    const flipped = await tx.retailPromotionRedemption.updateMany({
      where: { id: redemption.id, status: RetailPromotionRedemptionStatus.APPLIED },
      data: { status: RetailPromotionRedemptionStatus.REVERSED, reversedAt: new Date() },
    });
    if (flipped.count === 0) return null;

    const { promotionId, promoCodeId, guestId } = redemption;
    await tx.retailPromotion.updateMany({
      where: { id: promotionId, tenantId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    await tx.retailPromoCode.updateMany({
      where: { id: promoCodeId, tenantId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    await tx.retailPromotionMemberUsage.updateMany({
      where: { tenantId, promotionId, guestId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });

    const returnedByItem = new Map<string, number>();
    for (const line of giftLines) {
      returnedByItem.set(line.itemId, (returnedByItem.get(line.itemId) ?? 0) + line.quantity);
    }
    for (const [itemId, quantity] of returnedByItem) {
      await tx.retailPromotionGift.updateMany({
        where: { tenantId, promotionId, itemId, issuedQty: { gte: quantity } },
        data: { issuedQty: { decrement: quantity } },
      });
    }

    return { redemptionId: redemption.id, promotionId };
  }

  private async incrementWithin(
    run: () => Promise<{ count: number }>,
    code: string,
    message: string,
  ): Promise<void> {
    const { count } = await run();
    if (count === 0) throw promoError(code, message);
  }

  private async validatePromotion(
    tenantId: string,
    p: {
      discountType: RetailPromoDiscountType;
      discountValue: number;
      giftWarehouseId: string | null;
      giftItemIds: string[];
      eligibleItemIds: string[];
      startsAt: string | null;
      endsAt: string | null;
    },
  ): Promise<void> {
    if (p.discountType === RetailPromoDiscountType.PERCENT && p.discountValue > 100) {
      throw promoError('PROMO_INVALID', 'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100');
    }
    if (p.discountType !== RetailPromoDiscountType.NONE && p.discountValue <= 0) {
      throw promoError('PROMO_INVALID', 'ระบุมูลค่าส่วนลดให้มากกว่า 0');
    }
    if (p.discountType === RetailPromoDiscountType.NONE && p.giftItemIds.length === 0) {
      throw promoError('PROMO_INVALID', 'โปรโมชั่นต้องมีส่วนลดหรือของแถมอย่างน้อยหนึ่งอย่าง');
    }
    if (new Set(p.giftItemIds).size !== p.giftItemIds.length) {
      throw promoError('PROMO_INVALID', 'ของแถมซ้ำกัน — รวมเป็นรายการเดียวแล้วกำหนดจำนวนแทน');
    }
    if (p.startsAt && p.endsAt && new Date(p.endsAt) <= new Date(p.startsAt)) {
      throw promoError('PROMO_INVALID', 'วันสิ้นสุดต้องอยู่หลังวันเริ่ม');
    }
    if (p.giftItemIds.length > 0) {
      if (!p.giftWarehouseId) {
        throw promoError('PROMO_GIFT_WAREHOUSE_REQUIRED', 'เลือกคลังของแถมก่อนเพิ่มของแถม');
      }
      const wh = await this.prisma.warehouse.findFirst({
        where: { id: p.giftWarehouseId, tenantId, deletedAt: null },
      });
      if (!wh) throw promoError('PROMO_INVALID', 'ไม่พบคลังของแถมในองค์กรของคุณ');
      if (wh.type !== WarehouseType.PROMOTION) {
        throw promoError(
          'PROMO_GIFT_WAREHOUSE_TYPE',
          `คลัง "${wh.name}" ไม่ใช่คลังของแถม — ของแถมต้องตัดจากคลังประเภท "คลังของแถม" เท่านั้น`,
        );
      }
    }
    const itemIds = [...new Set([...p.giftItemIds, ...p.eligibleItemIds])];
    if (itemIds.length) {
      const found = await this.prisma.inventoryItem.count({
        where: { tenantId, id: { in: itemIds }, deletedAt: null },
      });
      if (found !== itemIds.length) throw promoError('PROMO_INVALID', 'มีสินค้าบางรายการไม่อยู่ในองค์กรของคุณ');
    }
  }

  private promotionData(dto: UpdateRetailPromotionDto) {
    const data: Prisma.RetailPromotionUncheckedUpdateInput & Prisma.RetailPromotionUncheckedCreateInput = {} as never;
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.status !== undefined) {
      data.status = dto.status;
      // ผู้จัดการตั้งสถานะเอง = ยกเลิกป้าย "ระบบหยุดอัตโนมัติ" (เปิดใหม่ หรือหยุดต่อด้วยเหตุผลของตัวเอง)
      data.autoPausedAt = null;
      data.pausedReason = null;
    }
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountType === RetailPromoDiscountType.NONE) data.discountValue = 0;
    else if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.maxDiscount !== undefined) data.maxDiscount = dto.maxDiscount;
    if (dto.minSpend !== undefined) data.minSpend = dto.minSpend;
    if (dto.eligibleItemIds !== undefined) data.eligibleItemIds = dto.eligibleItemIds;
    if (dto.eligibleTiers !== undefined) data.eligibleTiers = dto.eligibleTiers;
    if (dto.eligibleSegments !== undefined) data.eligibleSegments = dto.eligibleSegments;
    if (dto.giftWarehouseId !== undefined) data.giftWarehouseId = dto.giftWarehouseId;
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined) data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
    if (dto.perMemberLimit !== undefined) data.perMemberLimit = dto.perMemberLimit;
    return data;
  }

  private async requirePromotion(id: string, tenantId: string): Promise<void> {
    const found = await this.prisma.retailPromotion.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException({ code: 'PROMOTION_NOT_FOUND', message: 'ไม่พบโปรโมชั่นนี้' });
  }

  private async requireGuest(db: Db, tenantId: string, guestId: string) {
    const guest = await db.guest.findFirst({ where: { id: guestId, tenantId, anonymizedAt: null } });
    if (!guest) throw promoError('MEMBER_NOT_FOUND', 'ไม่พบสมาชิกนี้ในองค์กรของคุณ');
    return guest;
  }

  private async decorateMembers(
    db: Db,
    tenantId: string,
    guests: Array<{ id: string; firstName: string; lastName: string; phone: string | null; email: string | null }>,
  ): Promise<PromoMember[]> {
    if (!guests.length) return [];
    const ids = guests.map((g) => g.id);
    const [points, contacts] = await Promise.all([
      db.loyaltyPoint.findMany({ where: { tenantId, guestId: { in: ids } }, select: { guestId: true, tier: true } }),
      db.crmContact.findMany({ where: { tenantId, guestId: { in: ids } }, select: { id: true, guestId: true, segment: true } }),
    ]);
    const tierOf = new Map(points.map((p) => [p.guestId, p.tier]));
    const contactOf = new Map(contacts.map((c) => [c.guestId, c]));
    return guests.map((g) => ({
      guestId: g.id,
      name: `${g.firstName} ${g.lastName}`.trim(),
      phone: g.phone,
      email: g.email,
      tier: tierOf.get(g.id) ?? 'standard',
      segment: contactOf.get(g.id)?.segment ?? null,
      contactId: contactOf.get(g.id)?.id ?? null,
    }));
  }

  private async giftStock(db: Db, warehouseId: string, itemIds: string[]): Promise<Map<string, number>> {
    if (!itemIds.length) return new Map();
    const rows = await db.warehouseStock.findMany({
      where: { warehouseId, itemId: { in: itemIds } },
      select: { itemId: true, quantity: true },
    });
    return new Map(rows.map((r) => [r.itemId, Number(r.quantity)]));
  }

  private async itemNames(
    tenantId: string,
    itemIds: string[],
    db: Db = this.prisma,
  ): Promise<Map<string, { name: string; sku: string; unit: string }>> {
    const ids = [...new Set(itemIds)];
    if (!ids.length) return new Map();
    const rows = await db.inventoryItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true, sku: true, unit: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private toPromotion(p: {
    id: string;
    name: string;
    description: string | null;
    status: RetailPromotionStatus;
    discountType: RetailPromoDiscountType;
    discountValue: Prisma.Decimal;
    maxDiscount: Prisma.Decimal | null;
    minSpend: Prisma.Decimal;
    eligibleItemIds: Prisma.JsonValue;
    eligibleTiers: Prisma.JsonValue;
    eligibleSegments: Prisma.JsonValue;
    giftWarehouseId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usedCount: number;
    perMemberLimit: number | null;
    autoPausedAt?: Date | null;
    pausedReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      discountType: p.discountType,
      discountValue: Number(p.discountValue),
      maxDiscount: p.maxDiscount != null ? Number(p.maxDiscount) : null,
      minSpend: Number(p.minSpend),
      eligibleItemIds: jsonStringList(p.eligibleItemIds),
      eligibleTiers: jsonStringList(p.eligibleTiers),
      eligibleSegments: jsonStringList(p.eligibleSegments),
      giftWarehouseId: p.giftWarehouseId,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      usageLimit: p.usageLimit,
      usedCount: p.usedCount,
      perMemberLimit: p.perMemberLimit,
      autoPausedAt: p.autoPausedAt ?? null,
      pausedReason: p.pausedReason ?? null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private toGift(
    g: { id: string; itemId: string; quantity: number; budgetQty: number | null; issuedQty: number },
    items: Map<string, { name: string; sku: string; unit: string }>,
  ) {
    const item = items.get(g.itemId);
    return {
      id: g.id,
      itemId: g.itemId,
      name: item?.name ?? '—',
      sku: item?.sku ?? '',
      unit: item?.unit ?? '',
      quantity: g.quantity,
      budgetQty: g.budgetQty,
      issuedQty: g.issuedQty,
    };
  }

  private randomCode(length: number): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }
}

