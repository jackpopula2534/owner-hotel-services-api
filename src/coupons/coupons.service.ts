import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DiscountType = 'percent' | 'fixed';
export type AppliesTo = 'any_plan' | 'specific_plans' | 'first_invoice_only';

export interface CouponFeaturedConfig {
  /** When true the coupon is showcased as a featured campaign banner. */
  isFeatured: boolean;
  /** ISO datetime — banner appears at or after this moment. */
  featuredFrom?: string;
  /** ISO datetime — banner is hidden after this moment. */
  featuredUntil?: string;
  /** Optional banner headline override (defaults to coupon.name). */
  bannerHeadline?: string;
  /** Optional emoji shown in the banner pill. */
  bannerEmoji?: string;
}

export interface CreateCouponInput {
  code: string;
  name: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number; // 10 = 10% (when percent) or 1000 = 1000 THB (when fixed)
  appliesTo?: AppliesTo;
  applicablePlanIds?: string[];
  maxRedemptions?: number;
  maxRedemptionsPerTenant?: number;
  validFrom?: string; // ISO; defaults to now
  validUntil?: string; // ISO; null = forever
  /** Featured/banner showcase configuration. Stored under `metadata.featured`. */
  featured?: CouponFeaturedConfig;
}

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, 'code'>> & {
  /** Optional: rename the coupon code. Must remain unique. */
  code?: string;
  /** Toggle active state independently of the deactivate endpoint. */
  isActive?: boolean;
};

export interface ValidateCouponInput {
  code: string;
  tenantId: string;
  planId?: string;
  invoiceAmount: number;
  isFirstInvoice?: boolean;
}

export interface PreviewCouponInput {
  code: string;
  planId?: string;
  invoiceAmount: number;
  isFirstInvoice?: boolean;
}

export interface ValidateCouponResult {
  valid: boolean;
  reason?: string;
  coupon?: {
    id: string;
    code: string;
    name: string;
    discountType: DiscountType;
    discountValue: number;
  };
  discountAmount?: number;
  finalAmount?: number;
}

export interface RedeemCouponInput extends ValidateCouponInput {
  invoiceId?: string;
  subscriptionId?: string;
}

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────── admin CRUD ───────────

  async create(input: CreateCouponInput) {
    if (
      input.discountType === 'percent' &&
      (input.discountValue <= 0 || input.discountValue > 100)
    ) {
      throw new BadRequestException('percent discount must be between 0 and 100');
    }
    if (input.discountType === 'fixed' && input.discountValue <= 0) {
      throw new BadRequestException('fixed discount must be positive');
    }

    const metadata = input.featured ? { featured: input.featured } : null;

    return (this.prisma as any).subscription_coupons.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name,
        description: input.description,
        discount_type: input.discountType,
        discount_value: input.discountValue,
        applies_to: input.appliesTo || 'any_plan',
        applicable_plan_ids:
          input.appliesTo === 'specific_plans' ? input.applicablePlanIds || [] : null,
        max_redemptions: input.maxRedemptions,
        max_redemptions_per_tenant: input.maxRedemptionsPerTenant ?? 1,
        valid_from: input.validFrom ? new Date(input.validFrom) : new Date(),
        valid_until: input.validUntil ? new Date(input.validUntil) : null,
        metadata,
      },
    });
  }

  /**
   * List coupons currently in their "featured" window — banner-eligible.
   * Filters by metadata.featured.isFeatured + featured_from/until + still
   * active + not exhausted. Optionally narrows down to coupons applicable to
   * the given plan id.
   */
  async listFeatured(filters: { planId?: string }) {
    const now = new Date();
    // Cast `valid_from` / `valid_until` defensively — older rows may have
    // null `valid_from` even though the schema marks it required, and the
    // narrower MySQL DateTime range can otherwise drop legitimate rows.
    const rows = await (this.prisma as any).subscription_coupons.findMany({
      where: { is_active: 1 },
      orderBy: { created_at: 'desc' },
    });

    const filtered = rows.filter((c: any) => {
      // 1) global validity window — be tolerant of strings, Dates, and nulls
      if (c.valid_from && new Date(c.valid_from) > now) return false;
      if (c.valid_until && new Date(c.valid_until) < now) return false;

      // 2) featured window — coupon must explicitly opt in via metadata
      const featured = c?.metadata?.featured as CouponFeaturedConfig | undefined;
      if (!featured?.isFeatured) return false;
      const from = featured.featuredFrom ? new Date(featured.featuredFrom) : null;
      const until = featured.featuredUntil ? new Date(featured.featuredUntil) : null;
      if (from && from > now) return false;
      if (until && until < now) return false;

      // 3) redemption cap
      if (c.max_redemptions != null && c.redemptions_count >= c.max_redemptions) {
        return false;
      }
      // 4) plan filter — only when caller passes planId AND coupon is plan-scoped
      if (c.applies_to === 'specific_plans') {
        const allowed: string[] = Array.isArray(c.applicable_plan_ids) ? c.applicable_plan_ids : [];
        if (filters.planId && !allowed.includes(filters.planId)) return false;
      }
      return true;
    });

    this.logger.debug(
      `listFeatured(planId=${filters.planId ?? '-'}): scanned ${rows.length}, returned ${filtered.length}`,
    );
    return filtered;
  }

  async list(filters: { activeOnly?: boolean }) {
    return (this.prisma as any).subscription_coupons.findMany({
      where: filters.activeOnly ? { is_active: 1 } : {},
      orderBy: { created_at: 'desc' },
    });
  }

  async deactivate(id: string) {
    const coupon = await (this.prisma as any).subscription_coupons.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return (this.prisma as any).subscription_coupons.update({
      where: { id },
      data: { is_active: 0 },
    });
  }

  /**
   * Partially update an existing coupon. Only the fields explicitly present
   * in `input` are written; unspecified fields are preserved as-is. The
   * `metadata.featured` block is replaced atomically when `featured` is
   * supplied (set to `{ isFeatured: false, ... }` to unfeature).
   */
  async update(id: string, input: UpdateCouponInput) {
    const existing = await (this.prisma as any).subscription_coupons.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Coupon not found');

    if (
      input.discountType === 'percent' &&
      input.discountValue != null &&
      (input.discountValue <= 0 || input.discountValue > 100)
    ) {
      throw new BadRequestException('percent discount must be between 0 and 100');
    }
    if (input.discountType === 'fixed' && input.discountValue != null && input.discountValue <= 0) {
      throw new BadRequestException('fixed discount must be positive');
    }

    const data: Record<string, any> = {};
    if (input.code != null) data.code = input.code.trim().toUpperCase();
    if (input.name != null) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.discountType != null) data.discount_type = input.discountType;
    if (input.discountValue != null) data.discount_value = input.discountValue;
    if (input.appliesTo != null) {
      data.applies_to = input.appliesTo;
      // Reset applicable_plan_ids when scope changes away from specific_plans.
      if (input.appliesTo !== 'specific_plans') {
        data.applicable_plan_ids = null;
      }
    }
    if (input.applicablePlanIds !== undefined) {
      data.applicable_plan_ids = input.applicablePlanIds ?? null;
    }
    if (input.maxRedemptions !== undefined) {
      data.max_redemptions = input.maxRedemptions ?? null;
    }
    if (input.maxRedemptionsPerTenant != null) {
      data.max_redemptions_per_tenant = input.maxRedemptionsPerTenant;
    }
    if (input.validFrom !== undefined) {
      data.valid_from = input.validFrom ? new Date(input.validFrom) : new Date();
    }
    if (input.validUntil !== undefined) {
      data.valid_until = input.validUntil ? new Date(input.validUntil) : null;
    }
    if (input.isActive !== undefined) {
      data.is_active = input.isActive ? 1 : 0;
    }
    if (input.featured !== undefined) {
      const prevMetadata = (existing.metadata as Record<string, any>) || {};
      data.metadata = input.featured
        ? { ...prevMetadata, featured: input.featured }
        : { ...prevMetadata, featured: undefined };
    }

    try {
      return await (this.prisma as any).subscription_coupons.update({
        where: { id },
        data,
      });
    } catch (err: any) {
      // Surface friendlier error for unique-code collisions on rename.
      if (err?.code === 'P2002') {
        throw new BadRequestException('รหัสคูปองนี้ถูกใช้แล้ว — กรุณาเลือกรหัสอื่น');
      }
      throw err;
    }
  }

  async getStats(id: string) {
    const coupon = await (this.prisma as any).subscription_coupons.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    const totalDiscount = await (this.prisma as any).subscription_coupon_redemptions.aggregate({
      where: { coupon_id: id },
      _sum: { discount_amount: true },
      _count: { id: true },
    });
    return {
      coupon,
      redemptionsCount: totalDiscount._count?.id || 0,
      totalDiscountGiven: Number(totalDiscount._sum?.discount_amount || 0),
    };
  }

  // ─────────── public preview / showcase ───────────

  /**
   * Public coupon preview used by the pricing page before login. Validates
   * code/limit/dates/plan-eligibility but does NOT enforce per-tenant caps —
   * the actual `validate` step at checkout (post-login) re-runs the full
   * check with the resolved tenant_id.
   */
  async preview(input: PreviewCouponInput): Promise<ValidateCouponResult> {
    const code = input.code.trim().toUpperCase();
    const coupon = await (this.prisma as any).subscription_coupons.findUnique({
      where: { code },
    });

    if (!coupon || coupon.is_active !== 1) {
      return { valid: false, reason: 'รหัสคูปองไม่ถูกต้องหรือถูกปิดใช้งาน' };
    }

    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return { valid: false, reason: 'คูปองยังไม่เริ่มใช้งาน' };
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return { valid: false, reason: 'คูปองหมดอายุแล้ว' };
    }
    if (coupon.max_redemptions != null && coupon.redemptions_count >= coupon.max_redemptions) {
      return { valid: false, reason: 'คูปองถูกใช้ครบจำนวนสูงสุดแล้ว' };
    }
    if (coupon.applies_to === 'specific_plans') {
      const allowed: string[] = Array.isArray(coupon.applicable_plan_ids)
        ? coupon.applicable_plan_ids
        : [];
      if (!input.planId || !allowed.includes(input.planId)) {
        return {
          valid: false,
          reason: 'คูปองนี้ใช้ไม่ได้กับแพ็กเกจที่เลือก',
        };
      }
    }
    if (coupon.applies_to === 'first_invoice_only' && input.isFirstInvoice === false) {
      return { valid: false, reason: 'คูปองใช้ได้เฉพาะใบแจ้งหนี้ใบแรกเท่านั้น' };
    }

    const discountAmount = this.computeDiscount(
      coupon.discount_type,
      Number(coupon.discount_value),
      input.invoiceAmount,
    );

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discount_type,
        discountValue: Number(coupon.discount_value),
      },
      discountAmount,
      finalAmount: Math.max(0, input.invoiceAmount - discountAmount),
    };
  }

  /**
   * List all currently active and non-expired coupons. Used by the public
   * pricing page to show suggested coupon codes. When `planId` is provided,
   * coupons restricted to specific plans are filtered to those that include
   * the given plan id.
   */
  async listPublic(filters: { planId?: string }) {
    const now = new Date();
    const rows = await (this.prisma as any).subscription_coupons.findMany({
      where: { is_active: 1 },
      orderBy: { created_at: 'desc' },
    });

    const filtered = rows.filter((c: any) => {
      if (c.valid_from && new Date(c.valid_from) > now) return false;
      if (c.valid_until && new Date(c.valid_until) < now) return false;
      if (c.max_redemptions != null && c.redemptions_count >= c.max_redemptions) {
        return false;
      }
      if (c.applies_to === 'specific_plans') {
        const allowed: string[] = Array.isArray(c.applicable_plan_ids) ? c.applicable_plan_ids : [];
        if (filters.planId && !allowed.includes(filters.planId)) return false;
      }
      return true;
    });

    this.logger.debug(
      `listPublic(planId=${filters.planId ?? '-'}): scanned ${rows.length}, returned ${filtered.length}`,
    );
    return filtered;
  }

  // ─────────── tenant validation + redemption ───────────

  async validate(input: ValidateCouponInput): Promise<ValidateCouponResult> {
    const code = input.code.trim().toUpperCase();
    const coupon = await (this.prisma as any).subscription_coupons.findUnique({ where: { code } });

    if (!coupon || coupon.is_active !== 1) {
      return { valid: false, reason: 'Coupon not found or inactive' };
    }

    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return { valid: false, reason: 'Coupon is not yet valid' };
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return { valid: false, reason: 'Coupon has expired' };
    }

    if (coupon.max_redemptions != null && coupon.redemptions_count >= coupon.max_redemptions) {
      return { valid: false, reason: 'Coupon redemption limit reached' };
    }

    // Per-tenant cap
    const tenantUsage = await (this.prisma as any).subscription_coupon_redemptions.count({
      where: { coupon_id: coupon.id, tenant_id: input.tenantId },
    });
    if (tenantUsage >= coupon.max_redemptions_per_tenant) {
      return { valid: false, reason: 'You have already used this coupon' };
    }

    // Plan eligibility
    if (coupon.applies_to === 'specific_plans') {
      const allowed: string[] = Array.isArray(coupon.applicable_plan_ids)
        ? coupon.applicable_plan_ids
        : [];
      if (!input.planId || !allowed.includes(input.planId)) {
        return { valid: false, reason: 'Coupon not applicable to this plan' };
      }
    }
    if (coupon.applies_to === 'first_invoice_only' && !input.isFirstInvoice) {
      return { valid: false, reason: 'Coupon valid only on first invoice' };
    }

    const discountAmount = this.computeDiscount(
      coupon.discount_type,
      Number(coupon.discount_value),
      input.invoiceAmount,
    );

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        discountType: coupon.discount_type,
        discountValue: Number(coupon.discount_value),
      },
      discountAmount,
      finalAmount: Math.max(0, input.invoiceAmount - discountAmount),
    };
  }

  /**
   * Atomically apply a coupon to an invoice. Increments the redemption
   * counter and creates the audit row in a single transaction.
   */
  async redeem(input: RedeemCouponInput): Promise<ValidateCouponResult> {
    const validation = await this.validate(input);
    if (!validation.valid || !validation.coupon || validation.discountAmount == null) {
      throw new BadRequestException(validation.reason || 'Coupon invalid');
    }

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).subscription_coupons.update({
        where: { id: validation.coupon!.id },
        data: { redemptions_count: { increment: 1 } },
      });
      await (tx as any).subscription_coupon_redemptions.create({
        data: {
          coupon_id: validation.coupon!.id,
          tenant_id: input.tenantId,
          invoice_id: input.invoiceId,
          subscription_id: input.subscriptionId,
          discount_amount: validation.discountAmount,
          original_amount: input.invoiceAmount,
        },
      });
    });

    this.logger.log(
      `Coupon ${validation.coupon.code} redeemed by tenant ${input.tenantId} ` +
        `(discount=${validation.discountAmount})`,
    );

    return validation;
  }

  // ─────────── helpers ───────────

  private computeDiscount(type: DiscountType, value: number, invoiceAmount: number): number {
    if (type === 'percent') {
      return Math.round((invoiceAmount * value) / 100);
    }
    return Math.min(value, invoiceAmount); // never discount more than the invoice
  }
}
