import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import {
  CreateAddonDto,
  AddonBillingCycle,
  SubSystemCardMeta,
  ADDON_SYSTEM_VALUES,
} from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';
import { QueryAddonDto } from './dto/query-addon.dto';

// งานแม่บ้าน/แจ้งซ่อมไม่มีโค้ดของตัวเองแล้ว — เป็นความสามารถของ HR_MODULE
// (HOUSEKEEPING_MODULE / HOUSEKEEPING_MANAGEMENT / MAINTENANCE_MODULE ถูกลบทิ้ง
//  ด้วย migration 20260826060000 อย่าเพิ่มกลับเข้ามา)
export const ADDON_CODES = {
  HR_MODULE: 'HR_MODULE',
  POS_MODULE: 'POS_MODULE',
  RESTAURANT_MODULE: 'RESTAURANT_MODULE',
  CHANNEL_MANAGER: 'CHANNEL_MANAGER',
  LOYALTY_MODULE: 'LOYALTY_MODULE',
  INVENTORY_MODULE: 'INVENTORY_MODULE',
  COST_ACCOUNTING_MODULE: 'COST_ACCOUNTING_MODULE',
  ACCOUNTING_MODULE: 'ACCOUNTING_MODULE',
  CRM_MODULE: 'CRM_MODULE',
  CAMP_MODULE: 'CAMP_MODULE',
} as const;

export type AddonCode = (typeof ADDON_CODES)[keyof typeof ADDON_CODES];

/**
 * Parent → child entitlement map.
 *
 * Some legacy add-on codes were folded into a parent module (they are no longer
 * sold standalone) but their controller guards still use the child code via
 * `@RequireAddon('COST_ACCOUNTING_MODULE')`. Owning the parent module now
 * auto-grants every child code, so we don't have to touch dozens of controllers
 * or the frontend gating. Children are NOT seeded into the sellable catalog.
 *
 *   ACCOUNTING_MODULE  → COST_ACCOUNTING_MODULE (USALI)
 *   CRM_MODULE         → LOYALTY_MODULE
 *   RESTAURANT_MODULE  → POS_MODULE
 */
export const CHILD_ADDON_GRANTS: Record<string, string[]> = {
  ACCOUNTING_MODULE: ['COST_ACCOUNTING_MODULE'],
  CRM_MODULE: ['LOYALTY_MODULE'],
  RESTAURANT_MODULE: ['POS_MODULE'],
};

/**
 * Product lines. `plans.system` is HOTEL | CAMP; `add_ons.system` adds BOTH for
 * modules that work on either line (Restaurant, HR, Inventory, …).
 */
export type ProductSystem = 'HOTEL' | 'CAMP';
export type AddonSystem = ProductSystem | 'BOTH';

/** ค่าที่ `add_ons.system` รับได้ — BOTH = โมดูลกลางที่ขายได้ทั้งสองสาย (นิยามที่ DTO) */
export const ADDON_SYSTEMS: readonly AddonSystem[] = ADDON_SYSTEM_VALUES;

/**
 * Product-line compatibility — the one rule that keeps Hotel and Campground
 * apart. A module tagged for a single line (e.g. CAMP_MODULE → 'CAMP') may only
 * ever be bundled into, sold with, or surfaced on a plan of that same line; a
 * 'BOTH' module fits either. Enforced at every point where an add-on can attach
 * to a plan (seeder, Admin plan-addons endpoint) and everywhere we render a
 * catalog, so a hotel tenant can neither receive nor buy the campground module.
 */
export function isAddonAvailableForSystem(
  addonSystem: string | null | undefined,
  planSystem: string | null | undefined,
): boolean {
  const addon = (addonSystem ?? 'BOTH').trim().toUpperCase();
  const plan = (planSystem ?? 'HOTEL').trim().toUpperCase();
  return addon === 'BOTH' || addon === plan;
}

export type AddonSource = 'plan' | 'subscription' | 'trial';

export interface AddonStatus {
  code: string;
  name: string;
  isActive: boolean;
  /** ISO timestamp; only 'trial' entitlements expire — plan/subscription ones are null. */
  expiresAt: string | null;
  /**
   * Where the entitlement comes from:
   * - 'plan'         → feature included in the tenant's current plan (set by Admin in Plans → Features)
   * - 'subscription' → standalone add-on attached to the subscription (set by Admin/Tenant in Add-ons)
   * - 'trial'        → an approved, unexpired addon_trial_request (time-boxed, not billed)
   * All three unlock the same UI; this field is for diagnostics and for the
   * frontend to show "trial ends in N days" banners.
   */
  source: AddonSource;
}

/** The slice of an approved `addon_trial_requests` row that grants entitlement. */
interface TrialGrantRow {
  addon_code: string;
  addon_name: string | null;
  expires_at: Date;
}

/**
 * Public-facing AddOn entity (response shape)
 */
export interface AddonEntity {
  id: string;
  code: string;
  system: string;
  name: string;
  description: string | null;
  price: number;
  billingCycle: AddonBillingCycle;
  category: string | null;
  icon: string | null;
  displayOrder: number;
  minQuantity: number;
  maxQuantity: number;
  isActive: boolean;
  isSubSystem: boolean;
  subSystemMeta: SubSystemCardMeta[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAddons {
  items: AddonEntity[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

/**
 * A feature nested under its parent module in the public catalog. Sourced from
 * the `features` table where `module_code` matches the module's code.
 */
export interface PublicAddonFeature {
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  priceMonthly: number;
  displayOrder: number;
}

/**
 * Public catalog module = an active add-on plus the features that belong to it
 * (module ▸ feature tree). Used by the pricing page to show what each module
 * unlocks.
 */
export interface PublicCatalogAddon extends AddonEntity {
  features: PublicAddonFeature[];
}

@Injectable()
export class AddonService {
  private readonly logger = new Logger(AddonService.name);
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_NS = 'addon';
  private readonly CATALOG_CACHE_NS = 'addon-catalog';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // -------------------------------------------------------------------------
  // Tenant-facing logic (existing)
  // -------------------------------------------------------------------------

  /**
   * Statuses that count as "the tenant currently owns this subscription".
   * - active : paying customer
   * - trial  : free-trial period; trial plans still grant whatever the Admin
   *            attached to the trial plan in `plan_features`.
   * `pending`, `cancelled`, `expired` deliberately excluded — those tenants
   * should not see paid menus.
   */
  private readonly ENTITLEMENT_STATUSES = ['active', 'trial'] as const;

  async hasActiveAddon(tenantId: string, addonCode: AddonCode): Promise<boolean> {
    const cacheKey = `${tenantId}:${addonCode}`;
    return this.cacheService.getOrSet<boolean>(
      cacheKey,
      async () => {
        const addons = await this.getActiveAddons(tenantId);
        return addons.some((a) => a.code === addonCode && a.isActive);
      },
      { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
    );
  }

  /**
   * The tenant's product line, taken from the plan they subscribe to. Tenants
   * with no entitling subscription fall back to HOTEL (the default line), which
   * simply means they never see campground-only modules.
   */
  async getTenantSystem(tenantId: string): Promise<ProductSystem> {
    const cacheKey = `${tenantId}:system`;
    return this.cacheService.getOrSet<ProductSystem>(
      cacheKey,
      async () => {
        const subscription = await this.prisma.subscriptions.findFirst({
          where: {
            tenant_id: tenantId,
            status: { in: [...this.ENTITLEMENT_STATUSES] },
          },
          orderBy: { created_at: 'desc' },
          include: { plans_subscriptions_plan_idToplans: { select: { system: true } } },
        });
        const system = subscription?.plans_subscriptions_plan_idToplans?.system;
        return system?.trim().toUpperCase() === 'CAMP' ? 'CAMP' : 'HOTEL';
      },
      { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
    );
  }

  /**
   * Gate every path that grants a module to a tenant (trial approval, admin
   * "add add-on to subscription", …) on the tenant's product line.
   *
   * `plan_addons` is guarded by the plan's own system, but subscription-level
   * grants key off the `features` table, which has no product line of its own —
   * so the check has to be made here, against the module catalog, or a hotel
   * tenant can still end up entitled to the campground module.
   *
   * Unknown codes pass through: they are not sellable modules, so the caller's
   * own not-found handling (or the feature/child-grant machinery) owns them.
   */
  async assertAddonAllowedForTenant(tenantId: string, addonCode: string): Promise<void> {
    const catalog = await this.listActive();
    const addon = catalog.find((a) => a.code === addonCode);
    if (!addon) return;

    const tenantSystem = await this.getTenantSystem(tenantId);
    if (isAddonAvailableForSystem(addon.system, tenantSystem)) return;

    throw new BadRequestException(
      `โมดูล "${addon.name}" เป็นของธุรกิจ ${addon.system} — ` +
        `เพิ่มให้ผู้เช่าที่ใช้แผน ${tenantSystem} ไม่ได้ (คนละสายธุรกิจ)`,
    );
  }

  /**
   * The same product-line rule as `assertAddonAllowedForTenant`, as a predicate.
   * AddonGuard needs the answer (to raise a 403 with its own structured body)
   * rather than the 400 the grant paths want, so both share this one lookup.
   *
   * Unknown codes are "allowed" here: they are not sellable modules, so the
   * product line has nothing to say about them.
   */
  async isAddonAllowedForTenant(tenantId: string, addonCode: string): Promise<boolean> {
    const catalog = await this.listActive();
    const addon = catalog.find((a) => a.code === addonCode);
    if (!addon) return true;

    const tenantSystem = await this.getTenantSystem(tenantId);
    return isAddonAvailableForSystem(addon.system, tenantSystem);
  }

  /**
   * Returns every "module"-type entitlement the tenant currently has,
   * unioning four sources:
   *   1) plan_features        → modules included in the tenant's plan (Admin-controlled)
   *   2) plan_addons          → add-ons curated onto the plan by Admin
   *   3) subscription_features → standalone add-ons attached to the subscription
   *   4) addon_trial_requests  → approved, not-yet-expired free trials
   *
   * Deduplicates by code, in that order: a permanent entitlement always wins
   * over an expiring one, so an approved trial never shadows a module the
   * tenant already pays for (which would hand it a bogus expiry date).
   *
   * Trials are read straight from the request rows rather than being copied into
   * `subscription_features` on approval: that table has no expiry column and
   * feeds billing, so a trial written there would be both permanent and
   * invoiced. Filtering on `expires_at > now` here means a trial simply stops
   * granting access the moment it lapses, with no write path to go wrong.
   */
  async getActiveAddons(tenantId: string): Promise<AddonStatus[]> {
    const cacheKey = `${tenantId}:all`;
    return this.cacheService.getOrSet<AddonStatus[]>(
      cacheKey,
      async () => {
        const now = new Date();
        const subscription = await this.prisma.subscriptions.findFirst({
          where: {
            tenant_id: tenantId,
            status: { in: [...this.ENTITLEMENT_STATUSES] },
          },
          orderBy: { created_at: 'desc' },
          // Cast `include` through `any` because the generated Prisma client
          // may not yet know about `plan_addons` (a fresh model added in the
          // 20260510120000 migration). After `npx prisma generate` runs on the
          // build host the cast can be removed.
          include: {
            plans_subscriptions_plan_idToplans: {
              include: {
                plan_features: {
                  include: {
                    features: {
                      select: { code: true, name: true, type: true, is_active: true },
                    },
                  },
                },
                ...({ plan_addons: { include: { add_ons: true } } } as any),
              },
            } as any,
            subscription_features: {
              where: { is_active: 1 },
              include: {
                features: {
                  select: { code: true, name: true, type: true, is_active: true },
                },
              },
            },
          },
        });

        const merged = new Map<string, AddonStatus>();
        const plan = (subscription?.plans_subscriptions_plan_idToplans ?? null) as any;

        // 1) Plan-level features set by Admin in the Plans page (highest priority).
        const planFeatures = (plan?.plan_features ?? []) as any[];
        for (const pf of planFeatures) {
          const f = pf.features;
          if (!f || f.type !== 'module' || f.is_active !== 1) continue;
          merged.set(f.code, {
            code: f.code,
            name: f.name,
            isActive: true,
            expiresAt: null,
            source: 'plan',
          });
        }

        // 2) Plan-level add-ons (curated by Admin via /admin/plans/:id/addons).
        // The `add_ons` table has no `type` column — by convention every add-on
        // is a sellable module, so we don't filter by type here.
        const planAddons = (plan?.plan_addons ?? []) as any[];
        for (const pa of planAddons) {
          const a = pa.add_ons;
          if (!a) continue;
          if (Number(a.is_active) !== 1) continue;
          if (merged.has(a.code)) continue; // feature source wins
          merged.set(a.code, {
            code: a.code,
            name: a.name,
            isActive: true,
            expiresAt: null,
            source: 'plan',
          });
        }

        // 3) Standalone add-ons attached to the subscription.
        for (const sf of subscription?.subscription_features ?? []) {
          const f = sf.features;
          if (!f || f.type !== 'module' || f.is_active !== 1) continue;
          if (merged.has(f.code)) continue; // plan source wins
          merged.set(f.code, {
            code: f.code,
            name: f.name,
            isActive: true,
            expiresAt: null,
            source: 'subscription',
          });
        }

        // 4) Free trials the Admin approved and that haven't lapsed yet. These
        //    stand on their own — a tenant can be granted a trial before they
        //    ever hold a paid subscription, so this source is read even when the
        //    lookup above found nothing.
        const trials = await this.findActiveTrialGrants(tenantId, now);
        for (const trial of trials) {
          if (merged.has(trial.addon_code)) continue; // a paid entitlement outranks a trial
          merged.set(trial.addon_code, {
            code: trial.addon_code,
            name: trial.addon_name ?? trial.addon_code,
            isActive: true,
            expiresAt: trial.expires_at.toISOString(),
            source: 'trial',
          });
        }

        // 5) Parent → child entitlement expansion. Owning a parent module
        //    auto-grants its folded child codes (e.g. ACCOUNTING_MODULE grants
        //    COST_ACCOUNTING_MODULE) so legacy controller guards keep working.
        //    The child inherits the parent's expiry too — a trialled parent must
        //    not hand out children that outlive it.
        for (const parent of Array.from(merged.values())) {
          const children = CHILD_ADDON_GRANTS[parent.code];
          if (!children) continue;
          for (const childCode of children) {
            if (merged.has(childCode)) continue;
            merged.set(childCode, {
              code: childCode,
              name: childCode,
              isActive: true,
              expiresAt: parent.expiresAt,
              source: parent.source,
            });
          }
        }

        return Array.from(merged.values());
      },
      { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
    );
  }

  /**
   * Approved trials that are still running. `expires_at > now` is what actually
   * ends a trial, so an approved row whose date has passed — or one with no date
   * at all — grants nothing, whether or not the hourly expiry job has gotten
   * around to stamping it `expired`.
   */
  private async findActiveTrialGrants(tenantId: string, now: Date): Promise<TrialGrantRow[]> {
    const rows = await this.trialRequestsDb().findMany({
      where: {
        tenant_id: tenantId,
        status: 'approved',
        expires_at: { gt: now },
      },
      select: { addon_code: true, addon_name: true, expires_at: true },
    });
    return rows as TrialGrantRow[];
  }

  /**
   * `addon_trial_requests` was added after the checked-in Prisma client was
   * generated, so it is reached through a cast the way the other late models are.
   */
  private trialRequestsDb(): any {
    return (this.prisma as unknown as { addon_trial_requests: any }).addon_trial_requests;
  }

  /**
   * Drops every cached entitlement answer for one tenant — the per-code
   * `hasActiveAddon` keys, the `:all` list behind /addons/status, and the
   * `:system` product line. The product line has to go with them: a tenant who
   * switches between a HOTEL and a CAMP plan keeps the old line otherwise, and
   * AddonGuard turns that into a 403 (`*_WRONG_PRODUCT_LINE`) on a module the
   * new plan does grant.
   */
  async invalidateAddonCache(tenantId: string): Promise<void> {
    const allCodes = Object.values(ADDON_CODES);
    const delKeys = [
      ...allCodes.map((code) => ({ key: `${tenantId}:${code}`, ns: this.CACHE_NS })),
      { key: `${tenantId}:all`, ns: this.CACHE_NS },
      { key: `${tenantId}:system`, ns: this.CACHE_NS },
    ];
    for (const { key, ns } of delKeys) {
      await this.cacheService.del(key, ns);
    }
    this.logger.log(`Addon cache invalidated for tenant ${tenantId} (${delKeys.length} keys)`);
  }

  /**
   * Invalidate the addon cache for every tenant subscribed to a given plan.
   * Called after Admin changes the plan's feature list so the sidebar of all
   * affected tenants picks up the new entitlements without waiting for the
   * 5-minute TTL.
   */
  async invalidateAddonCacheForPlan(planId: string): Promise<void> {
    const subs = await this.prisma.subscriptions.findMany({
      where: {
        plan_id: planId,
        status: { in: [...this.ENTITLEMENT_STATUSES] },
      },
      select: { tenant_id: true },
    });
    const uniqueTenants = Array.from(new Set(subs.map((s) => s.tenant_id)));
    for (const tenantId of uniqueTenants) {
      await this.invalidateAddonCache(tenantId);
    }
    this.logger.log(
      `Addon cache invalidated for ${uniqueTenants.length} tenant(s) on plan ${planId}`,
    );
  }

  // -------------------------------------------------------------------------
  // Catalog CRUD (Admin Panel)
  // -------------------------------------------------------------------------

  /**
   * รายการ Add-on ทั้งหมด (สำหรับหน้า Admin) พร้อม pagination + filter
   */
  async list(query: QueryAddonDto): Promise<PaginatedAddons> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<string, unknown> = {};

    if (query.search) {
      where.OR = [{ code: { contains: query.search } }, { name: { contains: query.search } }];
    }
    if (typeof query.isActive === 'boolean') {
      where.is_active = query.isActive ? 1 : 0;
    }
    if (query.billingCycle) {
      where.billing_cycle = query.billingCycle;
    }
    if (query.category) {
      where.category = query.category;
    }
    // Business-line tab in the Admin catalog: "โรงแรม" lists what a hotel plan
    // can sell — its own modules plus the BOTH modules — and likewise for camp.
    const system = this.normalizeSystemFilter(query.system);
    if (system) {
      where.system = { in: [system, 'BOTH'] };
    }

    const addOnsClient = (this.prisma as unknown as { add_ons: any }).add_ons;
    const [records, total] = await this.prisma.$transaction([
      addOnsClient.findMany({
        where,
        orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      addOnsClient.count({ where }),
    ]);

    return {
      items: records.map(this.toEntity),
      meta: { page, limit, total },
    };
  }

  /**
   * Add-on ที่ active (public catalog ใช้ที่หน้า Subscription)
   */
  async listActive(): Promise<AddonEntity[]> {
    return this.cacheService.getOrSet<AddonEntity[]>(
      'active-list',
      async () => {
        const records = await this.addOnsClient().findMany({
          where: { is_active: 1 },
          orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
        });
        return records.map((r: AddonRecord) => this.toEntity(r));
      },
      { ttl: this.CACHE_TTL, namespace: this.CATALOG_CACHE_NS },
    );
  }

  /**
   * Public pricing catalog: active modules (optionally filtered to one product
   * line) with their features nested underneath (module ▸ feature).
   *
   * @param system  'HOTEL' | 'CAMP' — keep modules for that product line only.
   *                Modules flagged 'BOTH' are always included. Anything else
   *                (undefined/invalid) returns every active module.
   *
   * The active-module list is reused from `listActive()` (cached). Features are
   * queried fresh so an admin edit to a feature's `module_code` is reflected
   * immediately without waiting for the module catalog cache to expire.
   */
  async listPublicCatalog(system?: string): Promise<PublicCatalogAddon[]> {
    const normalized = this.normalizeSystemFilter(system);

    const modules = await this.listActive();
    const filtered = normalized
      ? modules.filter((m) => isAddonAvailableForSystem(m.system, normalized))
      : modules;

    const featureRows = await this.prisma.features.findMany({
      where: { is_active: 1, module_code: { not: null } },
      orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    });

    const featuresByModule = new Map<string, PublicAddonFeature[]>();
    for (const f of featureRows) {
      const key = f.module_code as string;
      const list = featuresByModule.get(key) ?? [];
      list.push({
        code: f.code,
        name: f.name,
        description: f.description ?? null,
        icon: f.icon ?? null,
        priceMonthly: Number(f.price_monthly ?? 0),
        displayOrder: f.display_order ?? 0,
      });
      featuresByModule.set(key, list);
    }

    return filtered.map((m) => ({ ...m, features: featuresByModule.get(m.code) ?? [] }));
  }

  /**
   * Accept only the two real product lines; ignore blanks/garbage so a bad
   * query string degrades to "show everything" rather than an empty catalog.
   */
  private normalizeSystemFilter(system?: string): 'HOTEL' | 'CAMP' | null {
    const upper = system?.trim().toUpperCase();
    return upper === 'HOTEL' || upper === 'CAMP' ? upper : null;
  }

  async findOne(id: string): Promise<AddonEntity> {
    const record = await this.addOnsClient().findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundException(`Add-on with id "${id}" not found`);
    }
    return this.toEntity(record);
  }

  async create(dto: CreateAddonDto): Promise<AddonEntity> {
    const exists = await this.addOnsClient().findUnique({ where: { code: dto.code } });
    if (exists) {
      throw new ConflictException(`Add-on code "${dto.code}" already exists`);
    }

    const created = await this.addOnsClient().create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        price: new Prisma.Decimal(dto.price),
        billing_cycle: dto.billingCycle ?? AddonBillingCycle.MONTHLY,
        category: dto.category ?? null,
        // Product line. Defaults to BOTH (sellable on either line) — the same
        // default the column carries — but an admin creating e.g. a campground
        // module must be able to pin it to CAMP, so the value is persisted here.
        system: dto.system ?? 'BOTH',
        icon: dto.icon ?? null,
        display_order: dto.displayOrder ?? 0,
        min_quantity: dto.minQuantity ?? 1,
        max_quantity: dto.maxQuantity ?? 1,
        is_active: dto.isActive === false ? 0 : 1,
        is_sub_system: dto.isSubSystem ? 1 : 0,
        sub_system_meta: dto.subSystemMeta ? JSON.stringify(dto.subSystemMeta) : null,
      },
    });

    await this.invalidateCatalogCache();
    this.logger.log(`Add-on created: ${created.code}`);
    return this.toEntity(created);
  }

  async update(id: string, dto: UpdateAddonDto): Promise<AddonEntity> {
    const existing = await this.addOnsClient().findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Add-on with id "${id}" not found`);
    }

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.addOnsClient().findUnique({ where: { code: dto.code } });
      if (conflict) {
        throw new ConflictException(`Add-on code "${dto.code}" already exists`);
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.billingCycle !== undefined) data.billing_cycle = dto.billingCycle;
    if (dto.category !== undefined) data.category = dto.category ?? null;
    if (dto.system !== undefined) data.system = dto.system;
    if (dto.icon !== undefined) data.icon = dto.icon ?? null;
    if (dto.displayOrder !== undefined) data.display_order = dto.displayOrder;
    if (dto.minQuantity !== undefined) data.min_quantity = dto.minQuantity;
    if (dto.maxQuantity !== undefined) data.max_quantity = dto.maxQuantity;
    if (dto.isActive !== undefined) data.is_active = dto.isActive ? 1 : 0;
    if (dto.isSubSystem !== undefined) data.is_sub_system = dto.isSubSystem ? 1 : 0;
    if (dto.subSystemMeta !== undefined) {
      data.sub_system_meta = dto.subSystemMeta ? JSON.stringify(dto.subSystemMeta) : null;
    }

    const updated = await this.addOnsClient().update({ where: { id }, data });

    // Moving a module between product lines can strip it from plans on the other
    // line, so drop any now-invalid bundling instead of leaving those tenants
    // entitled to a module their plan may no longer sell.
    if (dto.system !== undefined && dto.system !== existing.system) {
      await this.pruneCrossSystemPlanAddons(id);
    }

    await this.invalidateCatalogCache();
    this.logger.log(`Add-on updated: ${updated.code}`);
    return this.toEntity(updated);
  }

  /**
   * Upsert an add-on by its unique code. Used by the master seeder so that
   * re-running the seeder keeps the catalog in sync with the latest
   * definitions (renaming, retagging, repricing) without throwing on the
   * existing-code conflict that `create()` enforces.
   */
  async upsertByCode(dto: CreateAddonDto): Promise<AddonEntity> {
    const data = {
      name: dto.name,
      description: dto.description ?? null,
      price: new Prisma.Decimal(dto.price),
      billing_cycle: dto.billingCycle ?? AddonBillingCycle.MONTHLY,
      category: dto.category ?? null,
      system: dto.system ?? 'BOTH',
      icon: dto.icon ?? null,
      display_order: dto.displayOrder ?? 0,
      min_quantity: dto.minQuantity ?? 1,
      max_quantity: dto.maxQuantity ?? 1,
      is_active: dto.isActive === false ? 0 : 1,
      is_sub_system: dto.isSubSystem ? 1 : 0,
      sub_system_meta: dto.subSystemMeta ? JSON.stringify(dto.subSystemMeta) : null,
    };

    const record = await this.addOnsClient().upsert({
      where: { code: dto.code },
      update: data,
      create: { code: dto.code, ...data },
    });

    await this.invalidateCatalogCache();
    return this.toEntity(record);
  }

  async toggleActive(id: string): Promise<AddonEntity> {
    const existing = await this.addOnsClient().findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Add-on with id "${id}" not found`);
    }
    const updated = await this.addOnsClient().update({
      where: { id },
      data: { is_active: existing.is_active === 1 ? 0 : 1 },
    });
    await this.invalidateCatalogCache();
    return this.toEntity(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.addOnsClient().findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Add-on with id "${id}" not found`);
    }
    await this.addOnsClient().delete({ where: { id } });
    await this.invalidateCatalogCache();
    this.logger.log(`Add-on deleted: ${existing.code}`);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async invalidateCatalogCache(): Promise<void> {
    await this.cacheService.del('active-list', this.CATALOG_CACHE_NS);
  }

  /**
   * Remove every `plan_addons` row that bundles this add-on into a plan of the
   * other product line. Called after an admin retags a module (e.g. BOTH → CAMP)
   * so hotel plans stop granting a campground-only module to their tenants.
   */
  private async pruneCrossSystemPlanAddons(addonId: string): Promise<void> {
    const planAddonsClient = (this.prisma as unknown as { plan_addons: any }).plan_addons;
    const rows = (await planAddonsClient.findMany({
      where: { addon_id: addonId },
      include: {
        plans: { select: { id: true, code: true, system: true } },
        add_ons: { select: { code: true, system: true } },
      },
    })) as Array<{
      plan_id: string;
      plans?: { id: string; code: string; system: string } | null;
      add_ons?: { code: string; system: string } | null;
    }>;

    const stale = rows.filter(
      (row) =>
        row.plans && row.add_ons && !isAddonAvailableForSystem(row.add_ons.system, row.plans.system),
    );

    for (const row of stale) {
      await planAddonsClient.deleteMany({ where: { plan_id: row.plan_id, addon_id: addonId } });
      await this.invalidateAddonCacheForPlan(row.plan_id);
      this.logger.log(
        `Unbundled ${row.add_ons?.code} (${row.add_ons?.system}) from plan ` +
          `${row.plans?.code} (${row.plans?.system}) — cross product line`,
      );
    }
  }

  /**
   * Helper เพื่อเข้าถึง add_ons client ของ Prisma แบบ type-loose
   * (รองรับกรณี Prisma client ยังไม่ได้ regenerate ในเครื่องที่ไม่มี internet
   * — runtime ทำงานปกติเมื่อรัน `npx prisma generate` แล้ว)
   */
  private addOnsClient(): any {
    return (this.prisma as unknown as { add_ons: any }).add_ons;
  }

  private toEntity = (record: AddonRecord): AddonEntity => ({
    id: record.id,
    code: record.code,
    system: record.system ?? 'BOTH',
    name: record.name,
    description: record.description,
    price: Number(record.price),
    billingCycle: record.billing_cycle as AddonBillingCycle,
    category: record.category,
    icon: record.icon,
    displayOrder: record.display_order,
    minQuantity: record.min_quantity,
    maxQuantity: record.max_quantity,
    isActive: record.is_active === 1,
    isSubSystem: record.is_sub_system === 1,
    subSystemMeta: this.parseSubSystemMeta(record.sub_system_meta),
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  });

  private parseSubSystemMeta(raw: string | null | undefined): SubSystemCardMeta[] | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SubSystemCardMeta[]) : null;
    } catch {
      return null;
    }
  }

  /**
   * รายการ add-on ที่เป็น Sub System (is_sub_system = 1) เรียงตาม display_order.
   * ใช้โดย SubSystemsService เพื่อสร้างการ์ดในหน้าระบบย่อย.
   */
  async getSubSystemAddons(): Promise<AddonEntity[]> {
    const records: AddonRecord[] = await this.addOnsClient().findMany({
      where: { is_sub_system: 1 },
      orderBy: { display_order: 'asc' },
    });
    return records.map((r) => this.toEntity(r));
  }
}

interface AddonRecord {
  id: string;
  code: string;
  system?: string;
  name: string;
  description: string | null;
  price: Prisma.Decimal | number;
  billing_cycle: string;
  category: string | null;
  icon: string | null;
  display_order: number;
  min_quantity: number;
  max_quantity: number;
  is_active: number;
  is_sub_system: number;
  sub_system_meta: string | null;
  created_at: Date;
  updated_at: Date;
}
