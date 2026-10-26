import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';
import {
  BILL_LATER_MAX_WAIT_MONTHS,
  BILL_LATER_MODE,
  addMonthsUtc,
  bangkokToday,
  cancelEffectiveDate,
  computeBillLaterWindow,
  utcMidnight,
  vatOnTop,
} from '../../common/billing/addon-billing';

/** ทำไมเปิดแบบเก็บรอบบิลถัดไปไม่ได้ — หน้าจอใช้เลือกข้อความ แล้วพาไปชำระทันทีแทน */
export type BillLaterIneligibleReason =
  | 'NO_ACTIVE_PLAN'
  | 'NOT_MONTHLY'
  | 'NO_PAID_INVOICE'
  | 'OUTSTANDING_INVOICE'
  | 'CREDIT_LIMIT'
  | 'PREPAID_AHEAD'
  | 'PREPAID_ACTIVE';

export interface BillLaterBill {
  date: string;
  lines: Array<{ label: string; amount: number }>;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export interface BillLaterPreview {
  addonCode: string;
  addonName: string;
  monthlyPrice: number;
  mode: 'bill_later' | 'prepaid' | 'active';
  reason: BillLaterIneligibleReason | null;
  /** ใช้ฟรีถึงวันนี้ (exclusive) — null ถ้าคิดย้อนหลังทันที */
  freeUntil: string | null;
  billingStartsOn: string | null;
  committedUntil: string | null;
  /** เคยใช้ช่วงฟรีไปแล้ว → คิดตั้งแต่ต้นรอบปัจจุบัน */
  arrears: boolean;
  /** บิลรอบถัดไป (ยังไม่มีค่า add-on ถ้ายังอยู่ช่วงฟรี) */
  nextBill: BillLaterBill | null;
  /** บิลแรกที่มีค่า add-on */
  firstChargeBill: BillLaterBill | null;
  /** สถานะของ add-on ที่เปิดแบบเก็บรอบบิลถัดไปอยู่แล้ว */
  current: {
    activatedAt: string | null;
    billingStartsOn: string | null;
    committedUntil: string | null;
    cancelAt: string | null;
    earliestCancelDate: string;
  } | null;
}

const PERMANENT_SOURCES = new Set(['plan']);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * add-on แบบ "ใช้ก่อน เก็บเงินรอบบิลถัดไป" สำหรับลูกค้าที่มีแพ็กเกจรายเดือนอยู่แล้ว
 *
 * กันใช้ฟรีวน: ช่วงฟรีครั้งเดียวต่อ add-on ต่อกิจการ, สัญญาขั้นต่ำ 1 รอบที่คิดเงิน,
 * ต้องเคยจ่ายบิลแพ็กเกจ + ไม่มีบิลค้าง, วงเงินค่า add-on ที่ยังไม่ออกบิล ≤ ค่าแพ็กเกจต่อเดือน
 * ไม่เข้าเงื่อนไข → ใช้การซื้อแบบชำระทันที (AddonPurchaseService)
 */
@Injectable()
export class AddonBillLaterService {
  private readonly logger = new Logger(AddonBillLaterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  async preview(tenantId: string, addonCode: string, now = new Date()): Promise<BillLaterPreview> {
    const ctx = await this.loadContext(tenantId, addonCode, now);
    const base = {
      addonCode,
      addonName: ctx.addon.name,
      monthlyPrice: ctx.addon.price,
      freeUntil: null,
      billingStartsOn: null,
      committedUntil: null,
      arrears: false,
      nextBill: null,
      firstChargeBill: null,
      current: null,
    };

    if (ctx.existing?.is_active === 1 && ctx.existing.billing_mode === BILL_LATER_MODE) {
      return {
        ...base,
        mode: 'active',
        reason: null,
        billingStartsOn: day(ctx.existing.billing_starts_on),
        committedUntil: day(ctx.existing.committed_until),
        current: {
          activatedAt: ctx.existing.activated_at?.toISOString() ?? null,
          billingStartsOn: day(ctx.existing.billing_starts_on),
          committedUntil: day(ctx.existing.committed_until),
          cancelAt: day(ctx.existing.cancel_at),
          earliestCancelDate: day(
            cancelEffectiveDate(
              {
                committedUntil: ctx.existing.committed_until,
                billedThrough: ctx.existing.billed_through,
                billingStartsOn: ctx.existing.billing_starts_on,
              },
              ctx.today,
            ),
          )!,
        },
      };
    }

    if (ctx.reason || !ctx.window || !ctx.subscription) {
      return { ...base, mode: 'prepaid', reason: ctx.reason };
    }

    const { window, subscription } = ctx;
    const nextBoundary = utcMidnight(subscription.end_date);
    const planLine = { label: `แพ็กเกจ ${ctx.planName}`, amount: ctx.planPrice };
    const otherAddons = ctx.otherBilledAddons;
    const bill = (date: Date, addonMonths: number): BillLaterBill => {
      const lines = [planLine, ...otherAddons];
      if (addonMonths > 0) {
        lines.push({
          label: `${ctx.addon.name}${addonMonths > 1 ? ` × ${addonMonths} เดือน` : ''}`,
          amount: ctx.addon.price * addonMonths,
        });
      }
      const totals = vatOnTop(lines.reduce((s, l) => s + l.amount, 0));
      return { date: day(date)!, lines, ...totals };
    };
    // ใบต่ออายุถัดไปออกที่ขอบ nextBoundary — มีค่า add-on ก็ต่อเมื่อเริ่มคิดเงินแล้ว
    const firstChargeMonths = window.arrears ? 2 : 1;
    const nextBillHasAddon = window.firstChargeDate.getTime() === nextBoundary.getTime();
    return {
      ...base,
      mode: 'bill_later',
      reason: null,
      freeUntil: window.arrears ? null : day(window.billingStartsOn),
      billingStartsOn: day(window.billingStartsOn),
      committedUntil: day(window.committedUntil),
      arrears: window.arrears,
      nextBill: bill(nextBoundary, nextBillHasAddon ? firstChargeMonths : 0),
      firstChargeBill: bill(window.firstChargeDate, firstChargeMonths),
    };
  }

  async activate(
    tenantId: string,
    userId: string | null,
    addonCode: string,
    now = new Date(),
  ): Promise<BillLaterPreview> {
    const ctx = await this.loadContext(tenantId, addonCode, now);

    // ยกเลิกไว้แล้วแต่ยังไม่ถึงวันมีผล → กดเปิดอีกครั้ง = ใช้ต่อ (ล้างวันยกเลิก)
    if (ctx.existing?.is_active === 1 && ctx.existing.billing_mode === BILL_LATER_MODE) {
      if (ctx.existing.cancel_at) {
        await this.prisma.subscription_features.update({
          where: { id: ctx.existing.id },
          data: { cancel_at: null, updated_at: now },
        });
        await this.invalidate(tenantId);
      }
      return this.preview(tenantId, addonCode, now);
    }
    if (ctx.reason || !ctx.window || !ctx.subscription) {
      throw new ConflictException({
        code: ctx.reason ?? 'NOT_ELIGIBLE',
        message: 'บัญชีนี้ยังเปิดแบบชำระในรอบบิลถัดไปไม่ได้ กรุณาชำระทันที',
      });
    }

    const data = {
      price: ctx.addon.price,
      quantity: 1,
      is_active: 1,
      billing_mode: BILL_LATER_MODE,
      activated_at: now,
      billing_starts_on: ctx.window.billingStartsOn,
      billed_through: null,
      committed_until: ctx.window.committedUntil,
      cancel_at: null,
      accepted_at: now,
      accepted_by: userId,
      updated_at: now,
    };
    const sub = ctx.subscription;
    const featureId = ctx.featureId;
    await this.prisma.$transaction(async (tx) => {
      // วงเงิน: เช็คซ้ำใน transaction กันกดพร้อมกันหลายตัว
      const unbilled = await tx.subscription_features.findMany({
        where: {
          subscription_id: sub.id,
          is_active: 1,
          billing_mode: BILL_LATER_MODE,
          billed_through: null,
          NOT: { feature_id: featureId },
        },
        select: { price: true },
      });
      const used = unbilled.reduce((s, r) => s + Number(r.price), 0);
      if (used + ctx.addon.price > ctx.planPrice) {
        throw new ConflictException({
          code: 'CREDIT_LIMIT',
          message: 'ยอด add-on ที่รอเรียกเก็บเกินวงเงิน กรุณาชำระทันที',
        });
      }
      if (ctx.existing) {
        await tx.subscription_features.update({ where: { id: ctx.existing.id }, data });
      } else {
        await tx.subscription_features.create({
          data: { ...data, subscription_id: sub.id, feature_id: featureId },
        });
      }
    });
    // หลัง commit เท่านั้น — ไม่งั้น read พร้อมกันอุ่น cache จากข้อมูลที่ยังไม่ commit
    await this.invalidate(tenantId);
    this.logger.log(
      `Add-on ${addonCode} bill-later for tenant ${tenantId}: billing from ${day(ctx.window.billingStartsOn)}`,
    );
    return this.preview(tenantId, addonCode, now);
  }

  /** ยกเลิก: มีผลไม่ก่อนสัญญาขั้นต่ำ/สิ้นรอบที่จ่ายแล้ว — ใช้ได้ถึงวันนั้น */
  async cancel(tenantId: string, addonCode: string, now = new Date()): Promise<BillLaterPreview> {
    const ctx = await this.loadContext(tenantId, addonCode, now);
    const row = ctx.existing;
    if (!row || row.is_active !== 1 || row.billing_mode !== BILL_LATER_MODE) {
      throw new BadRequestException('ไม่มี add-on ที่เปิดแบบชำระในรอบบิลถัดไป');
    }
    const cancelAt = cancelEffectiveDate(
      {
        committedUntil: row.committed_until,
        billedThrough: row.billed_through,
        billingStartsOn: row.billing_starts_on,
      },
      ctx.today,
    );
    await this.prisma.subscription_features.update({
      where: { id: row.id },
      data: { cancel_at: cancelAt, updated_at: now },
    });
    await this.invalidate(tenantId);
    return this.preview(tenantId, addonCode, now);
  }

  /** ปิด add-on ที่ถึงวันยกเลิกแล้ว (คิดตามปฏิทินไทย) */
  @Cron('20 0 * * *', { timeZone: 'Asia/Bangkok' })
  async deactivateCancelled(now = new Date()): Promise<number> {
    const due = await this.prisma.subscription_features.findMany({
      where: { is_active: 1, billing_mode: BILL_LATER_MODE, cancel_at: { lte: bangkokToday(now) } },
      select: { id: true, subscriptions: { select: { tenant_id: true } } },
    });
    for (const row of due) {
      await this.prisma.subscription_features.updateMany({
        where: { id: row.id, is_active: 1 },
        data: { is_active: 0, updated_at: now },
      });
      await this.invalidate(row.subscriptions.tenant_id);
    }
    if (due.length) this.logger.log(`Deactivated ${due.length} cancelled bill-later add-on(s)`);
    return due.length;
  }

  private async invalidate(tenantId: string): Promise<void> {
    await this.addonService.invalidateAddonCache(tenantId).catch((err: Error) => {
      this.logger.error(`Failed to invalidate addon cache: ${err.message}`);
    });
  }

  private async loadContext(tenantId: string, addonCode: string, now: Date) {
    const catalog = await this.addonService.listActive();
    const addon = catalog.find((a) => a.code === addonCode);
    if (!addon || !addon.isActive || !(addon.price > 0) || addon.billingCycle !== 'monthly') {
      throw new BadRequestException('add-on นี้ยังไม่เปิดขายแบบรายเดือน');
    }
    await this.addonService.assertAddonAllowedForTenant(tenantId, addonCode);
    const feature = await this.prisma.features.findFirst({
      where: { code: addonCode, type: 'module' },
      select: { id: true },
    });
    if (!feature) throw new BadRequestException('add-on นี้ยังไม่เปิดขายแบบรายเดือน');

    const owned = (await this.addonService.getActiveAddons(tenantId)).find(
      (a) => a.code === addonCode,
    );
    if (owned && PERMANENT_SOURCES.has(owned.source)) {
      throw new ConflictException('แพ็กเกจของคุณรวม add-on นี้อยู่แล้ว');
    }

    const today = bangkokToday(now);
    const subscription = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId, status: { in: ['active', 'trial'] } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        status: true,
        billing_cycle: true,
        end_date: true,
        plans_subscriptions_plan_idToplans: { select: { name: true, price_monthly: true } },
      },
    });
    const existing = subscription
      ? await this.prisma.subscription_features.findFirst({
          where: { subscription_id: subscription.id, feature_id: feature.id },
          orderBy: { created_at: 'desc' },
        })
      : null;
    if (existing?.is_active === 1 && existing.billing_mode !== BILL_LATER_MODE) {
      throw new ConflictException('แพ็กเกจของคุณรวม add-on นี้อยู่แล้ว');
    }
    const plan = subscription?.plans_subscriptions_plan_idToplans;
    const planPrice = Number(plan?.price_monthly ?? 0);
    const others = subscription
      ? await this.prisma.subscription_features.findMany({
          where: {
            subscription_id: subscription.id,
            is_active: 1,
            NOT: { feature_id: feature.id },
          },
          select: {
            price: true,
            billing_mode: true,
            billed_through: true,
            billing_starts_on: true,
            features: { select: { name: true } },
          },
        })
      : [];

    const reason = await this.ineligibility({
      tenantId,
      subscription,
      planPrice,
      today,
      owned,
      unbilledOthers: others
        .filter((o) => o.billing_mode === BILL_LATER_MODE && !o.billed_through)
        .reduce((s, o) => s + Number(o.price), 0),
      addonPrice: addon.price,
    });

    let window = null as ReturnType<typeof computeBillLaterWindow> | null;
    if (!reason && subscription) {
      const [trial, previous] = await Promise.all([
        this.prisma.addon_trial_requests.findFirst({
          where: { tenant_id: tenantId, addon_code: addonCode, approved_at: { not: null } },
          select: { id: true },
        }),
        // ช่วงฟรีครั้งเดียวต่อกิจการ — นับทุก subscription (เปลี่ยนแพ็กเกจแล้วไม่ได้ฟรีใหม่)
        this.prisma.subscription_features.findFirst({
          where: {
            feature_id: feature.id,
            billing_mode: BILL_LATER_MODE,
            subscriptions: { tenant_id: tenantId },
          },
          select: { id: true },
        }),
      ]);
      window = computeBillLaterWindow({
        today,
        nextBoundary: subscription.end_date,
        usedTrial: Boolean(trial),
        usedFreeWindow: Boolean(previous),
      });
    }

    return {
      addon: { name: addon.name, price: addon.price },
      featureId: feature.id,
      subscription,
      existing,
      planName: plan?.name ?? '',
      planPrice,
      today,
      reason,
      window,
      // ค่า add-on ตัวอื่นที่อยู่ในบิลรอบถัดไปแน่ ๆ (แบบเดิม หรือ bill-later ที่ถึงกำหนดแล้ว)
      otherBilledAddons: others
        .filter(
          (o) =>
            o.billing_mode !== BILL_LATER_MODE ||
            (o.billing_starts_on && subscription && o.billing_starts_on <= subscription.end_date),
        )
        .map((o) => ({ label: o.features?.name ?? 'Add-on', amount: Number(o.price) })),
    };
  }

  private async ineligibility(input: {
    tenantId: string;
    subscription: { id: string; status: string; billing_cycle: string; end_date: Date } | null;
    planPrice: number;
    today: Date;
    owned: { source: string; expiresAt?: Date | string | null } | undefined;
    unbilledOthers: number;
    addonPrice: number;
  }): Promise<BillLaterIneligibleReason | null> {
    const { subscription: sub } = input;
    if (!sub || sub.status !== 'active' || !(input.planPrice > 0)) return 'NO_ACTIVE_PLAN';
    if (sub.billing_cycle !== 'monthly') return 'NOT_MONTHLY';
    // จ่ายล่วงหน้าแบบชำระทันทีอยู่ → ต่ออายุแบบเดิม (ไม่ซ้อนสองระบบ)
    if (input.owned?.source === 'purchase') return 'PREPAID_ACTIVE';
    if (utcMidnight(sub.end_date) > addMonthsUtc(input.today, BILL_LATER_MAX_WAIT_MONTHS)) {
      return 'PREPAID_AHEAD';
    }
    const [paid, outstanding] = await Promise.all([
      this.prisma.invoices.count({
        where: { tenant_id: input.tenantId, subscription_id: { not: null }, status: 'paid' },
      }),
      this.prisma.invoices.count({
        where: {
          tenant_id: input.tenantId,
          subscription_id: { not: null },
          booking_id: null,
          status: { in: ['pending', 'finalized'] },
        },
      }),
    ]);
    if (paid === 0) return 'NO_PAID_INVOICE';
    if (outstanding > 0) return 'OUTSTANDING_INVOICE';
    if (input.unbilledOthers + input.addonPrice > input.planPrice) return 'CREDIT_LIMIT';
    return null;
  }
}
