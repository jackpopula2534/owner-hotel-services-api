import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';

export const ADDON_CODES = {
  HR_MODULE: 'HR_MODULE',
  POS_MODULE: 'POS_MODULE',
  RESTAURANT_MODULE: 'RESTAURANT_MODULE',
  HOUSEKEEPING_MODULE: 'HOUSEKEEPING_MODULE',
  CHANNEL_MANAGER: 'CHANNEL_MANAGER',
  LOYALTY_MODULE: 'LOYALTY_MODULE',
  INVENTORY_MODULE: 'INVENTORY_MODULE',
  COST_ACCOUNTING_MODULE: 'COST_ACCOUNTING_MODULE',
} as const;

export type AddonCode = (typeof ADDON_CODES)[keyof typeof ADDON_CODES];

export interface AddonStatus {
  code: string;
  name: string;
  isActive: boolean;
  expiresAt: string | null;
}

@Injectable()
export class AddonService {
  private readonly logger = new Logger(AddonService.name);
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CACHE_NS = 'addon';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Check whether a specific add-on is active for the given tenant.
   * Result is cached for 5 minutes to reduce DB hits.
   *
   * subscription_features.is_active is stored as TinyInt (1 = active, 0 = inactive).
   * We filter by is_active = 1.
   */
  async hasActiveAddon(tenantId: string, addonCode: AddonCode): Promise<boolean> {
    const cacheKey = `${tenantId}:${addonCode}`;
    return this.cacheService.getOrSet<boolean>(
      cacheKey,
      async () => {
        const record = await this.prisma.subscription_features.findFirst({
          where: {
            is_active: 1,
            features: { code: addonCode },
            subscriptions: {
              tenant_id: tenantId,
              status: 'active',
            },
          },
          select: { id: true },
        });
        return record !== null;
      },
      { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
    );
  }

  /**
   * Return list of all active module add-ons for the given tenant.
   */
  async getActiveAddons(tenantId: string): Promise<AddonStatus[]> {
    const cacheKey = `${tenantId}:all`;
    return this.cacheService.getOrSet<AddonStatus[]>(
      cacheKey,
      async () => {
        const records = await this.prisma.subscription_features.findMany({
          where: {
            is_active: 1,
            subscriptions: {
              tenant_id: tenantId,
              status: 'active',
            },
            features: {
              type: 'module',
            },
          },
          include: {
            features: {
              select: { code: true, name: true },
            },
          },
        });
        return records.map((r) => ({
          code: r.features.code,
          name: r.features.name,
          isActive: true,
          expiresAt: null,
        }));
      },
      { ttl: this.CACHE_TTL, namespace: this.CACHE_NS },
    );
  }

  /**
   * Invalidate add-on cache for a tenant (call after subscription change).
   */
  async invalidateAddonCache(tenantId: string): Promise<void> {
    const allCodes = Object.values(ADDON_CODES);
    const delKeys = [
      ...allCodes.map((code) => ({ key: `${tenantId}:${code}`, ns: this.CACHE_NS })),
      { key: `${tenantId}:all`, ns: this.CACHE_NS },
    ];
    for (const { key, ns } of delKeys) {
      await this.cacheService.del(key, ns);
    }
    this.logger.log(`Addon cache invalidated for tenant ${tenantId} (${allCodes.length + 1} keys)`);
  }
}
