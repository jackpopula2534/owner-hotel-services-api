import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';

/**
 * Addon Trial Expiry Cron Job
 *
 * Flips approved trials to `expired` once their `expires_at` has passed.
 *
 * Access is NOT what this job controls — `AddonService.getActiveAddons()` only
 * counts an approved trial while `expires_at > now`, so a lapsed trial stops
 * granting entitlement on its own even if this job never runs. What the job does
 * is (a) settle the row's status so Admin lists and the tenant's history read
 * correctly, and (b) drop the tenant's addon cache, without which the sidebar
 * would keep showing the module for up to the 5-minute cache TTL after it lapsed.
 */
@Injectable()
export class AddonTrialExpiryService {
  private readonly logger = new Logger(AddonTrialExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  private db(): any {
    return (this.prisma as unknown as { addon_trial_requests: any }).addon_trial_requests;
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'addon-trial-expiry' })
  async handleExpiredTrials(): Promise<void> {
    try {
      await this.expireDueTrials();
    } catch (error) {
      this.logger.error(
        'Failed to expire due addon trials',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Returns how many trials were expired. Exposed (not private) so tests can drive it. */
  async expireDueTrials(): Promise<number> {
    const now = new Date();

    const due: Array<{ id: string; tenant_id: string; addon_code: string }> = await this.db()
      .findMany({
        where: { status: 'approved', expires_at: { lte: now } },
        select: { id: true, tenant_id: true, addon_code: true },
      });

    if (due.length === 0) return 0;

    await this.db().updateMany({
      where: { id: { in: due.map((r) => r.id) } },
      data: { status: 'expired' },
    });

    // One tenant may have had several trials lapse in the same hour; the cache is
    // per-tenant, so invalidate once each.
    const tenantIds = Array.from(new Set(due.map((r) => r.tenant_id)));
    for (const tenantId of tenantIds) {
      await this.addonService.invalidateAddonCache(tenantId);
    }

    this.logger.log(
      `Expired ${due.length} addon trial(s) across ${tenantIds.length} tenant(s): ` +
        due.map((r) => `${r.tenant_id}/${r.addon_code}`).join(', '),
    );

    return due.length;
  }
}
