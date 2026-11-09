import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AddonQuotaConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddonService } from '../addons/addon.service';
import {
  QuotaSource,
  RESERVATION_STATUS,
  STALE_RESERVATION_MINUTES,
  bangkokStartOfDate,
  quotaCycle,
  type QuotaCycle,
} from './addon-quota.constants';

export interface AddonQuotaStatus {
  addonCode: string;
  metricCode: string;
  period: string;
  /** รอบโควตาปัจจุบัน (นับจากวันเริ่มใช้ add-on) — trial: null */
  periodStart: string | null;
  /** วันที่โควตารีเซ็ตครั้งถัดไป — trial: null (โควตาทั้งช่วงทดลอง) */
  resetsAt: string | null;
  entitled: boolean;
  source: QuotaSource | null;
  /** วันหมดช่วงทดลองใช้ (เฉพาะ source = trial) */
  trialEndsAt: string | null;
  /** โควตาที่รวมในแพ็ก — paid: ต่อเดือน, trial: ตลอดช่วงทดลอง */
  included: number;
  used: number;
  remaining: number;
  overageAllowed: boolean;
  overageUsed: number;
  overageCap: number | null;
  overageUnitPriceThb: number;
  rateLimitPerMinute: number;
  refundOnFailure: boolean;
  /** เงื่อนไขช่วงทดลองที่ใช้ตอนอนุมัติ (ไว้โชว์ในหน้าขาย) */
  trialDays: number;
  trialIncluded: number;
  canRun: boolean;
  /** เหตุผลที่รันไม่ได้ (ตรงกับ code ของ error ตอน reserve) */
  blockedReason: 'ADDON_NOT_ENTITLED' | 'QUOTA_EXCEEDED' | 'TRIAL_QUOTA_EXCEEDED' | null;
}

export interface QuotaReservation {
  reservationId: string;
  source: QuotaSource;
  isOverage: boolean;
  /** โควตาในแพ็กที่เหลือหลังจองครั้งนี้ */
  remaining: number;
}

export interface ReserveInput {
  tenantId: string;
  addonCode: string;
  userId?: string;
  refType?: string;
  refId?: string;
}

interface Entitlement {
  source: QuotaSource;
  expiresAt: string | null;
  /** จุดเริ่มนับรอบโควตา — null = เดือนปฏิทิน */
  anchor: Date | null;
}

type Tx = Prisma.TransactionClient;

/**
 * โควตาการใช้งานของ add-on ที่คิดตามจำนวนครั้ง (เริ่มจาก CAMP_3D_MAP → CAMP_3D_AI_EXTRACT)
 *
 * ขั้นตอนต่อหนึ่งงาน: reserve() ก่อนเรียก AI → commit() เมื่อสำเร็จ / refund() เมื่อล้มเหลว
 * (หรือใช้ runWithQuota() ที่ห่อให้ครบ)
 *
 * - สิทธิ์ดูจาก AddonService.getActiveAddons() ตรง ๆ ไม่ผ่าน AddonGuard — guard
 *   ปล่อย role admin ของ tenant ผ่านโดยไม่ได้ซื้อ ซึ่งที่นี่คือเงินจริง
 * - กันแย่งโควตาพร้อมกัน: บวก usage_counters ก่อนในทรานแซกชันเดียวกัน แถวนั้นถูก
 *   ล็อกจน commit ทรานแซกชัน คำขอที่สองของ tenant เดียวกันจึงต้องรอและนับใหม่
 */
@Injectable()
export class AddonQuotaService {
  private readonly logger = new Logger(AddonQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  async getConfig(addonCode: string): Promise<AddonQuotaConfig> {
    const config = await this.prisma.addonQuotaConfig.findUnique({ where: { addonCode } });
    if (!config) throw new NotFoundException(`ไม่มีการตั้งโควตาของ add-on ${addonCode}`);
    return config;
  }

  async getStatus(tenantId: string, addonCode: string): Promise<AddonQuotaStatus> {
    const config = await this.getConfig(addonCode);
    const entitlement = await this.findEntitlement(tenantId, addonCode);
    const cycle = quotaCycle(new Date(), entitlement?.anchor ?? null);
    const counts = entitlement
      ? await this.countUsage(this.prisma, tenantId, config, entitlement.source, cycle)
      : { used: 0, overageUsed: 0 };
    return this.buildStatus(config, entitlement, cycle, counts);
  }

  /**
   * จองโควตา 1 ครั้ง — โยน 403 ADDON_NOT_ENTITLED / 402 QUOTA_EXCEEDED |
   * TRIAL_QUOTA_EXCEEDED / 429 RATE_LIMITED แล้วไม่มีอะไรถูกนับ
   */
  async reserve(input: ReserveInput): Promise<QuotaReservation> {
    const config = await this.getConfig(input.addonCode);
    const entitlement = await this.findEntitlement(input.tenantId, input.addonCode);
    if (!entitlement) {
      throw new ForbiddenException({
        code: 'ADDON_NOT_ENTITLED',
        message: 'ยังไม่ได้ซื้อหรือทดลองใช้ add-on นี้',
        addonCode: input.addonCode,
      });
    }
    await this.refundStale(input.tenantId, config);

    const cycle = quotaCycle(new Date(), entitlement.anchor);
    const period = cycle.period;
    return this.prisma.$transaction(async (tx) => {
      await this.adjustCounter(tx, input.tenantId, config.metricCode, period, 1);

      if (config.rateLimitPerMinute > 0) {
        // นับงานที่ล้มเหลว/คืนโควตาไปแล้วด้วย — เรียก AI ไปแล้วก็มีต้นทุน
        const recent = await tx.addonUsageReservation.count({
          where: {
            tenantId: input.tenantId,
            addonCode: input.addonCode,
            createdAt: { gte: new Date(Date.now() - 60_000) },
          },
        });
        if (recent >= config.rateLimitPerMinute) {
          throw new HttpException(
            {
              code: 'RATE_LIMITED',
              message: `ใช้ได้สูงสุด ${config.rateLimitPerMinute} ครั้งต่อนาที รอสักครู่แล้วลองใหม่`,
              limitPerMinute: config.rateLimitPerMinute,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      const counts = await this.countUsage(tx, input.tenantId, config, entitlement.source, cycle);
      const status = this.buildStatus(config, entitlement, cycle, counts);
      if (!status.canRun) {
        throw new HttpException(
          {
            code: status.blockedReason,
            message:
              status.blockedReason === 'TRIAL_QUOTA_EXCEEDED'
                ? `ช่วงทดลองใช้ร่างฉากได้ ${status.included} ครั้ง ใช้ครบแล้ว — ซื้อ add-on เพื่อใช้ต่อ`
                : `ใช้โควตารอบนี้ครบแล้ว (${status.used}/${status.included})`,
            metric: config.metricCode,
            used: status.used,
            limit: status.included,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      const isOverage = entitlement.source === 'paid' && status.remaining <= 0;
      const row = await tx.addonUsageReservation.create({
        data: {
          tenantId: input.tenantId,
          addonCode: input.addonCode,
          metricCode: config.metricCode,
          period,
          source: entitlement.source,
          isOverage,
          status: RESERVATION_STATUS.RESERVED,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          createdBy: input.userId ?? null,
        },
      });
      return {
        reservationId: row.id,
        source: entitlement.source,
        isOverage,
        remaining: Math.max(0, status.remaining - (isOverage ? 0 : 1)),
      };
    });
  }

  /** งานสำเร็จ — ยืนยันการใช้โควตา (เรียกซ้ำได้ ไม่มีผล) */
  async commit(tenantId: string, reservationId: string): Promise<void> {
    await this.prisma.addonUsageReservation.updateMany({
      where: { id: reservationId, tenantId, status: RESERVATION_STATUS.RESERVED },
      data: { status: RESERVATION_STATUS.COMMITTED, settledAt: new Date() },
    });
  }

  /**
   * งานล้มเหลว — คืนโควตาถ้าตั้ง refundOnFailure ไว้ ไม่งั้นนับเป็นใช้แล้ว
   * คืนได้ครั้งเดียว: เปลี่ยนสถานะจาก reserved เท่านั้น แถวที่ถูกเปลี่ยนแล้วไม่ลด counter ซ้ำ
   * `force` = คืนเสมอไม่สนค่าตั้ง (งานค้างจากฝั่งเราเอง ลูกค้าไม่ควรเสียโควตา)
   * @returns true เมื่อคืนโควตาจริง
   */
  async refund(
    tenantId: string,
    reservationId: string,
    reason?: string,
    force = false,
  ): Promise<boolean> {
    const row = await this.prisma.addonUsageReservation.findFirst({
      where: { id: reservationId, tenantId },
    });
    if (!row || row.status !== RESERVATION_STATUS.RESERVED) return false;
    const config = await this.getConfig(row.addonCode);
    const failureReason = reason ? reason.slice(0, 255) : null;

    if (!config.refundOnFailure && !force) {
      await this.prisma.addonUsageReservation.updateMany({
        where: { id: reservationId, tenantId, status: RESERVATION_STATUS.RESERVED },
        data: { status: RESERVATION_STATUS.COMMITTED, failureReason, settledAt: new Date() },
      });
      return false;
    }

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.addonUsageReservation.updateMany({
        where: { id: reservationId, tenantId, status: RESERVATION_STATUS.RESERVED },
        data: { status: RESERVATION_STATUS.REFUNDED, failureReason, settledAt: new Date() },
      });
      if (changed.count === 0) return false;
      await this.adjustCounter(tx, tenantId, row.metricCode, row.period, -1);
      return true;
    });
  }

  /** จอง → รันงาน → commit / refund ตามผล (error เดิมถูกโยนต่อ) */
  async runWithQuota<T>(
    input: ReserveInput,
    fn: (reservation: QuotaReservation) => Promise<T>,
  ): Promise<T> {
    const reservation = await this.reserve(input);
    try {
      const result = await fn(reservation);
      await this.commit(input.tenantId, reservation.reservationId);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.refund(input.tenantId, reservation.reservationId, reason).catch(
        (refundErr: unknown) =>
          this.logger.error(
            `Refund failed for reservation ${reservation.reservationId}: ${
              refundErr instanceof Error ? refundErr.message : String(refundErr)
            }`,
          ),
      );
      throw err;
    }
  }

  // ─────────── private ───────────

  /** สิทธิ์จริงของ tenant — ไม่มี bypass ของ role admin แบบ AddonGuard */
  private async findEntitlement(tenantId: string, addonCode: string): Promise<Entitlement | null> {
    const addons = await this.addonService.getActiveAddons(tenantId);
    const found = addons.find((a) => a.code === addonCode && a.isActive);
    if (!found) return null;
    if (found.source === 'trial')
      return { source: 'trial', expiresAt: found.expiresAt, anchor: null };
    return {
      source: 'paid',
      expiresAt: found.expiresAt,
      anchor: await this.findCycleAnchor(tenantId, addonCode, found.source).catch((err: Error) => {
        this.logger.warn(`Quota anchor lookup failed for ${tenantId}: ${err.message}`);
        return null;
      }),
    };
  }

  /**
   * วันเริ่มนับรอบโควตาตามที่มาของสิทธิ์
   * - purchase: ต้นสายของช่วงที่ต่ออายุติดกัน (ต่ออายุไม่ทำให้รอบเลื่อน)
   * - subscription: วันที่เปิด add-on (00:00 น. เวลาไทย)
   * - plan: วันตั้งรอบบิลของแพ็กเกจ (00:00 น. เวลาไทย)
   */
  private async findCycleAnchor(
    tenantId: string,
    addonCode: string,
    source: string,
  ): Promise<Date | null> {
    if (source === 'purchase') {
      const paid = await this.prisma.addonPurchase.findMany({
        where: { tenantId, addonCode, status: 'paid', periodStart: { not: null } },
        orderBy: { periodEnd: 'desc' },
        select: { periodStart: true, periodEnd: true },
        take: 36,
      });
      let anchor: Date | null = null;
      for (const row of paid) {
        if (anchor && row.periodEnd && row.periodEnd.getTime() !== anchor.getTime()) break;
        anchor = row.periodStart;
      }
      return anchor;
    }
    const sub = await this.prisma.subscriptions.findFirst({
      where: { tenant_id: tenantId, status: { in: ['active', 'trial'] } },
      orderBy: { created_at: 'desc' },
      select: { id: true, billing_anchor_date: true, start_date: true },
    });
    if (!sub) return null;
    if (source === 'subscription') {
      const row = await this.prisma.subscription_features.findFirst({
        where: { subscription_id: sub.id, is_active: 1, features: { code: addonCode } },
        orderBy: { created_at: 'desc' },
        select: { activated_at: true, created_at: true },
      });
      if (!row) return null;
      // timestamp → วันตามปฏิทินไทยก่อน (bangkokStartOfDate รับค่าแบบ @db.Date)
      const at = row.activated_at ?? row.created_at;
      return bangkokStartOfDate(new Date(at.getTime() + 7 * 60 * 60 * 1000));
    }
    const date = sub.billing_anchor_date ?? sub.start_date;
    return date ? bangkokStartOfDate(date) : null;
  }

  /**
   * paid: นับเฉพาะรอบนี้ / trial: นับตลอดช่วงทดลอง (ทุก period) — ไม่นับแถวที่คืนโควตาแล้ว
   * กรอง createdAt ≥ ต้นรอบด้วย: เปลี่ยน anchor แล้วคีย์ period อาจซ้ำกับรอบเก่า
   */
  private async countUsage(
    db: Tx | PrismaService,
    tenantId: string,
    config: AddonQuotaConfig,
    source: QuotaSource,
    cycle: QuotaCycle,
  ): Promise<{ used: number; overageUsed: number }> {
    const base: Prisma.AddonUsageReservationWhereInput = {
      tenantId,
      addonCode: config.addonCode,
      source,
      status: { not: RESERVATION_STATUS.REFUNDED },
      ...(source === 'paid' ? { period: cycle.period, createdAt: { gte: cycle.start } } : {}),
    };
    const [used, overageUsed] = await Promise.all([
      db.addonUsageReservation.count({ where: base }),
      source === 'paid'
        ? db.addonUsageReservation.count({ where: { ...base, isOverage: true } })
        : Promise.resolve(0),
    ]);
    return { used, overageUsed };
  }

  private buildStatus(
    config: AddonQuotaConfig,
    entitlement: Entitlement | null,
    cycle: QuotaCycle,
    counts: { used: number; overageUsed: number },
  ): AddonQuotaStatus {
    const overageUnitPriceThb = Number(config.overageUnitPriceThb);
    const isTrial = entitlement?.source === 'trial';
    const included = isTrial ? config.trialIncluded : config.includedPerPeriod;
    // used รวมส่วนเกินด้วย โควตาในแพ็กที่ใช้ไป = used - overageUsed
    const remaining = Math.max(0, included - (counts.used - counts.overageUsed));
    const overageAllowed = !isTrial && overageUnitPriceThb > 0;
    const overageRoom =
      overageAllowed &&
      (config.maxOveragePerPeriod == null || counts.overageUsed < config.maxOveragePerPeriod);

    let blockedReason: AddonQuotaStatus['blockedReason'] = null;
    if (!entitlement) blockedReason = 'ADDON_NOT_ENTITLED';
    else if (remaining <= 0 && !overageRoom)
      blockedReason = isTrial ? 'TRIAL_QUOTA_EXCEEDED' : 'QUOTA_EXCEEDED';

    return {
      addonCode: config.addonCode,
      metricCode: config.metricCode,
      period: cycle.period,
      periodStart: entitlement && !isTrial ? cycle.start.toISOString() : null,
      resetsAt: entitlement && !isTrial ? cycle.end.toISOString() : null,
      entitled: !!entitlement,
      source: entitlement?.source ?? null,
      trialEndsAt: isTrial ? (entitlement?.expiresAt ?? null) : null,
      included,
      used: counts.used,
      remaining,
      overageAllowed,
      overageUsed: counts.overageUsed,
      overageCap: config.maxOveragePerPeriod,
      overageUnitPriceThb,
      rateLimitPerMinute: config.rateLimitPerMinute,
      refundOnFailure: config.refundOnFailure,
      trialDays: config.trialDays,
      trialIncluded: config.trialIncluded,
      canRun: blockedReason === null,
      blockedReason,
    };
  }

  /** usage_counters แบบ atomic — ลดไม่ต่ำกว่า 0 (ค่าเดียวกับ UsageMeteringService.record) */
  private async adjustCounter(
    tx: Tx,
    tenantId: string,
    metricCode: string,
    period: string,
    delta: 1 | -1,
  ): Promise<void> {
    if (delta > 0) {
      await tx.$executeRaw`
        INSERT INTO usage_counters (id, tenant_id, metric_code, period, value, peak_value, last_event_at, created_at, updated_at)
        VALUES (UUID(), ${tenantId}, ${metricCode}, ${period}, 1, 1, NOW(6), NOW(6), NOW(6))
        ON DUPLICATE KEY UPDATE
          value = value + 1,
          peak_value = GREATEST(peak_value, value),
          last_event_at = NOW(6),
          updated_at = NOW(6)`;
      return;
    }
    await tx.$executeRaw`
      UPDATE usage_counters SET value = GREATEST(value - 1, 0), updated_at = NOW(6)
      WHERE tenant_id = ${tenantId} AND metric_code = ${metricCode} AND period = ${period}`;
  }

  /** คืนโควตางานที่ค้างสถานะ reserved นานผิดปกติ (process ตายก่อน commit/refund) */
  private async refundStale(tenantId: string, config: AddonQuotaConfig): Promise<void> {
    const stale = await this.prisma.addonUsageReservation.findMany({
      where: {
        tenantId,
        addonCode: config.addonCode,
        status: RESERVATION_STATUS.RESERVED,
        createdAt: { lt: new Date(Date.now() - STALE_RESERVATION_MINUTES * 60_000) },
      },
      select: { id: true },
      take: 20,
    });
    for (const row of stale) {
      await this.refund(tenantId, row.id, 'stale reservation', true);
    }
  }
}
