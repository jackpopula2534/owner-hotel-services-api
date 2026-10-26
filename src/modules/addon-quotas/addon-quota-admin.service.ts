import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AddonQuotaConfig, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AddonService } from '../addons/addon.service';
import {
  QuotaAddonCode,
  RESERVATION_STATUS,
  isQuotaAddon,
  quotaPeriod,
} from './addon-quota.constants';
import { UpdateAddonQuotaDto } from './dto/addon-quota.dto';

export interface AddonQuotaConfigView {
  addonCode: string;
  addonName: string;
  addonActive: boolean;
  metricCode: string;
  priceMonthlyThb: number;
  includedPerPeriod: number;
  overageUnitPriceThb: number;
  maxOveragePerPeriod: number | null;
  trialDays: number;
  trialIncluded: number;
  rateLimitPerMinute: number;
  refundOnFailure: boolean;
  updatedAt: string;
}

export interface AddonQuotaSummary {
  addonCode: string;
  period: string;
  /** ซื้อแยก (subscription_features) บน subscription ที่ active */
  paidSubscribers: number;
  /** ได้สิทธิ์จากแพลนที่ bundle add-on นี้ (ไม่มีรายรับแยก) */
  bundledSubscribers: number;
  /** ทดลองใช้ที่ยังไม่หมดอายุ และยังไม่ได้ซื้อ */
  trialTenants: number;
  /** ค่า add-on รายเดือนตามราคาที่ล็อกไว้ในแต่ละ subscription (ไม่ใช่ราคาแคตตาล็อก) */
  subscriptionRevenueThb: number;
  /** ส่วนเกินที่ commit แล้วของเดือนนี้ × ราคาส่วนเกินปัจจุบัน — ยอดจริงคิดตอนปิดงวด */
  overageRevenueThb: number;
  totalRevenueThb: number;
  usage: {
    committed: number;
    refunded: number;
    pending: number;
    trial: number;
    overage: number;
  };
}

/**
 * ฝั่งแอดมินของโควตา add-on: ตั้งราคา/โควตา, สรุปรายรับ, และปิดงวดค่าส่วนเกิน
 * ทุก query ข้าม tenant จึงรันใน runUnscoped
 */
@Injectable()
export class AddonQuotaAdminService {
  private readonly logger = new Logger(AddonQuotaAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
    private readonly tenantContext: TenantContextService,
  ) {}

  assertQuotaAddon(code: string): QuotaAddonCode {
    if (!isQuotaAddon(code)) throw new NotFoundException(`add-on ${code} ไม่มีโควตาการใช้งาน`);
    return code;
  }

  async getConfig(addonCode: QuotaAddonCode): Promise<AddonQuotaConfigView> {
    const [config, addon] = await Promise.all([
      this.findConfig(addonCode),
      this.findAddon(addonCode),
    ]);
    return this.toView(config, addon);
  }

  async updateConfig(
    addonCode: QuotaAddonCode,
    dto: UpdateAddonQuotaDto,
    adminId?: string,
  ): Promise<AddonQuotaConfigView> {
    const [current, addon] = await Promise.all([
      this.findConfig(addonCode),
      this.findAddon(addonCode),
    ]);

    const included = dto.includedPerPeriod ?? current.includedPerPeriod;
    const overagePrice = dto.overageUnitPriceThb ?? Number(current.overageUnitPriceThb);
    if (included === 0 && overagePrice === 0) {
      throw new BadRequestException(
        'ต้องมีโควตาในแพ็กหรือราคาส่วนเกินอย่างใดอย่างหนึ่ง ไม่งั้นลูกค้าที่ซื้อแล้วใช้ไม่ได้เลย',
      );
    }

    const data: Prisma.AddonQuotaConfigUpdateInput = { updatedBy: adminId ?? null };
    if (dto.includedPerPeriod !== undefined) data.includedPerPeriod = dto.includedPerPeriod;
    if (dto.overageUnitPriceThb !== undefined)
      data.overageUnitPriceThb = new Prisma.Decimal(dto.overageUnitPriceThb);
    if (dto.maxOveragePerPeriod !== undefined) data.maxOveragePerPeriod = dto.maxOveragePerPeriod;
    if (dto.trialDays !== undefined) data.trialDays = dto.trialDays;
    if (dto.trialIncluded !== undefined) data.trialIncluded = dto.trialIncluded;
    if (dto.rateLimitPerMinute !== undefined) data.rateLimitPerMinute = dto.rateLimitPerMinute;
    if (dto.refundOnFailure !== undefined) data.refundOnFailure = dto.refundOnFailure;

    const updated = await this.prisma.addonQuotaConfig.update({ where: { addonCode }, data });

    let price = Number(addon.price);
    if (dto.priceMonthlyThb !== undefined && dto.priceMonthlyThb !== price) {
      // ราคาใหม่มีผลกับการซื้อครั้งถัดไป — subscription_features.price ของลูกค้าเดิมไม่ถูกแตะ
      await this.addonService.update(addon.id, { price: dto.priceMonthlyThb });
      await this.prisma.features.updateMany({
        where: { code: addonCode, type: 'module' },
        data: { price_monthly: new Prisma.Decimal(dto.priceMonthlyThb) },
      });
      price = dto.priceMonthlyThb;
    }

    this.logger.log(`Quota config updated: ${addonCode} by ${adminId ?? 'unknown'}`);
    return this.toView(updated, { ...addon, price });
  }

  async getSummary(
    addonCode: QuotaAddonCode,
    period: string = quotaPeriod(),
  ): Promise<AddonQuotaSummary> {
    const config = await this.findConfig(addonCode);
    return this.tenantContext.runUnscoped(async () => {
      const [standalone, bundledPlanIds, trials, usageGroups] = await Promise.all([
        this.prisma.subscription_features.findMany({
          where: {
            is_active: 1,
            features: { code: addonCode, type: 'module' },
            subscriptions: { status: 'active' },
          },
          select: { price: true, quantity: true, subscriptions: { select: { tenant_id: true } } },
        }),
        this.prisma.plan_addons.findMany({
          where: { add_ons: { code: addonCode } },
          select: { plan_id: true },
        }),
        this.prisma.addon_trial_requests.findMany({
          where: { addon_code: addonCode, status: 'approved', expires_at: { gt: new Date() } },
          select: { tenant_id: true },
        }),
        this.prisma.addonUsageReservation.groupBy({
          by: ['status', 'source', 'isOverage'],
          where: { addonCode, period },
          _count: { _all: true },
        }),
      ]);

      const paidTenants = new Set(standalone.map((r) => r.subscriptions.tenant_id));
      const subscriptionRevenueThb = standalone.reduce(
        (sum, r) => sum + Number(r.price) * (r.quantity ?? 1),
        0,
      );

      const bundled = bundledPlanIds.length
        ? await this.prisma.subscriptions.findMany({
            where: { status: 'active', plan_id: { in: bundledPlanIds.map((p) => p.plan_id) } },
            select: { tenant_id: true },
          })
        : [];
      const bundledTenants = new Set(
        bundled.map((s) => s.tenant_id).filter((t) => !paidTenants.has(t)),
      );
      const trialTenants = new Set(
        trials.map((t) => t.tenant_id).filter((t) => !paidTenants.has(t) && !bundledTenants.has(t)),
      );

      const usage = { committed: 0, refunded: 0, pending: 0, trial: 0, overage: 0 };
      // รายรับส่วนเกินนับเฉพาะที่ commit แล้ว ให้ตรงกับที่ settlePeriod ออกบิลจริง
      let billableOverage = 0;
      for (const g of usageGroups) {
        const n = g._count._all;
        if (g.status === RESERVATION_STATUS.COMMITTED) usage.committed += n;
        else if (g.status === RESERVATION_STATUS.REFUNDED) usage.refunded += n;
        else usage.pending += n;
        if (g.status !== RESERVATION_STATUS.REFUNDED) {
          if (g.source === 'trial') usage.trial += n;
          if (g.isOverage) usage.overage += n;
        }
        if (g.isOverage && g.status === RESERVATION_STATUS.COMMITTED && g.source !== 'trial')
          billableOverage += n;
      }
      const overageRevenueThb = round2(billableOverage * Number(config.overageUnitPriceThb));

      return {
        addonCode,
        period,
        paidSubscribers: paidTenants.size,
        bundledSubscribers: bundledTenants.size,
        trialTenants: trialTenants.size,
        subscriptionRevenueThb: round2(subscriptionRevenueThb),
        overageRevenueThb,
        totalRevenueThb: round2(subscriptionRevenueThb + overageRevenueThb),
        usage,
      };
    });
  }

  /**
   * ปิดงวดค่าส่วนเกินของ add-on เดือนก่อน — เขียน usage_overage_charges ต่อ (tenant, metric, period)
   * ซ้ำได้: unique index กันแถวซ้ำ (แผนหลักไม่มีคอลัมน์ max_<metric> ของ metric พวกนี้ จึงไม่ชนกับ
   * OverageBillingService.settlePeriod)
   */
  /**
   * รอบโควตานับจากวันเริ่มใช้ของแต่ละกิจการ — รอบที่ขึ้นต้นเดือน M-1 ยังไม่จบในวันที่ 1 ของเดือน M
   * จึงสรุปรอบที่ขึ้นต้นเดือน M-2 (จบครบทุกกิจการแล้ว) ค่าส่วนเกินเข้าบิลช้าลงราว 1 เดือน
   */
  @Cron('10 3 1 * *', { name: 'addon-overage-settlement', timeZone: 'Asia/Bangkok' })
  async settlePreviousMonth(): Promise<number> {
    const now = new Date();
    const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const prev = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 2, 15));
    try {
      return await this.settlePeriod(quotaPeriod(prev));
    } catch (err) {
      this.logger.error(
        'Add-on overage settlement failed',
        err instanceof Error ? err.stack : String(err),
      );
      return 0;
    }
  }

  async settlePeriod(period: string): Promise<number> {
    const configs = await this.prisma.addonQuotaConfig.findMany();
    let created = 0;
    for (const config of configs) {
      const unitPrice = Number(config.overageUnitPriceThb);
      const rows = await this.tenantContext.runUnscoped(
        async () =>
          await this.prisma.addonUsageReservation.groupBy({
            by: ['tenantId', 'isOverage'],
            where: {
              addonCode: config.addonCode,
              period,
              source: 'paid',
              status: RESERVATION_STATUS.COMMITTED,
            },
            _count: { _all: true },
          }),
      );
      const byTenant = new Map<string, { usage: number; overage: number }>();
      for (const r of rows) {
        const t = byTenant.get(r.tenantId) ?? { usage: 0, overage: 0 };
        byTenant.set(r.tenantId, {
          usage: t.usage + r._count._all,
          overage: t.overage + (r.isOverage ? r._count._all : 0),
        });
      }

      for (const [tenantId, { usage, overage }] of byTenant) {
        if (overage <= 0 || unitPrice <= 0) continue;
        try {
          await this.tenantContext.runUnscoped(
            async () =>
              await this.prisma.usage_overage_charges.create({
                data: {
                  tenant_id: tenantId,
                  metric_code: config.metricCode,
                  period,
                  usage_amount: usage,
                  included_amount: usage - overage,
                  overage_amount: overage,
                  unit_price: new Prisma.Decimal(unitPrice),
                  total_charge: new Prisma.Decimal(round2(overage * unitPrice)),
                  status: 'pending',
                },
              }),
          );
          created += 1;
        } catch (err) {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
            throw err;
        }
      }
    }
    if (created > 0) this.logger.log(`Add-on overage settlement ${period}: ${created} charge(s)`);
    return created;
  }

  // ─────────── private ───────────

  private async findConfig(addonCode: string): Promise<AddonQuotaConfig> {
    const config = await this.prisma.addonQuotaConfig.findUnique({ where: { addonCode } });
    if (!config)
      throw new NotFoundException(`ยังไม่มีการตั้งโควตาของ ${addonCode} — รัน seeder ก่อน`);
    return config;
  }

  private async findAddon(
    code: string,
  ): Promise<{ id: string; name: string; price: Prisma.Decimal | number; is_active: number }> {
    const addon = await this.prisma.add_ons.findUnique({
      where: { code },
      select: { id: true, name: true, price: true, is_active: true },
    });
    if (!addon) throw new NotFoundException(`ไม่พบ add-on ${code}`);
    return addon;
  }

  private toView(
    config: AddonQuotaConfig,
    addon: { name: string; price: Prisma.Decimal | number; is_active: number },
  ): AddonQuotaConfigView {
    return {
      addonCode: config.addonCode,
      addonName: addon.name,
      addonActive: Number(addon.is_active) === 1,
      metricCode: config.metricCode,
      priceMonthlyThb: Number(addon.price),
      includedPerPeriod: config.includedPerPeriod,
      overageUnitPriceThb: Number(config.overageUnitPriceThb),
      maxOveragePerPeriod: config.maxOveragePerPeriod,
      trialDays: config.trialDays,
      trialIncluded: config.trialIncluded,
      rateLimitPerMinute: config.rateLimitPerMinute,
      refundOnFailure: config.refundOnFailure,
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
