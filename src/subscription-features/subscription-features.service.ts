import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddonService } from '../modules/addons/addon.service';
import { CreateSubscriptionFeatureDto } from './dto/create-subscription-feature.dto';

@Injectable()
export class SubscriptionFeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  async create(createSubscriptionFeatureDto: CreateSubscriptionFeatureDto) {
    await this.assertFeatureMatchesTenantLine(
      createSubscriptionFeatureDto.subscriptionId,
      createSubscriptionFeatureDto.featureId,
    );

    const data: any = {
      subscription_id: createSubscriptionFeatureDto.subscriptionId,
      feature_id: createSubscriptionFeatureDto.featureId,
      price: createSubscriptionFeatureDto.price,
      // Always explicitly set is_active=1 so AddonGuard's `where: { is_active: 1 }`
      // filter reliably finds this row. Never rely on DB default alone — some older
      // migration paths or manual inserts may leave the column as NULL.
      is_active: 1,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    const created = await this.prisma.subscription_features.create({
      data,
      include: { subscriptions: true, features: true },
    });

    // The row IS the entitlement, so the tenant's cached add-on list is now stale
    // — without this they'd wait out the 5-minute TTL for a module they were just
    // granted.
    await this.invalidateTenant(created.subscriptions?.tenant_id);

    return created;
  }

  /**
   * Product-line separation for this legacy grant path — the same rule Admin's
   * newer "add feature to subscription" endpoint enforces.
   *
   * `subscription_features` points at `features`, which carries no product line
   * of its own, so the check runs against the module catalog: the feature's own
   * code (module-type features share the add-on code) and its parent module.
   * Without it, a platform admin posting here can hand a hotel tenant the
   * campground module — the exact coupling we removed from the plans, reachable
   * through the back door.
   */
  private async assertFeatureMatchesTenantLine(
    subscriptionId: string,
    featureId: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscriptions.findUnique({
      where: { id: subscriptionId },
      select: { tenant_id: true },
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${subscriptionId}" not found`);
    }

    const feature = await this.prisma.features.findUnique({
      where: { id: featureId },
      select: { code: true, module_code: true },
    });
    if (!feature) {
      throw new NotFoundException(`Feature with ID "${featureId}" not found`);
    }

    await this.addonService.assertAddonAllowedForTenant(subscription.tenant_id, feature.code);
    if (feature.module_code) {
      await this.addonService.assertAddonAllowedForTenant(
        subscription.tenant_id,
        feature.module_code,
      );
    }
  }

  findAll() {
    return this.prisma.subscription_features.findMany({
      include: { subscriptions: true, features: true },
    });
  }

  findBySubscriptionId(subscriptionId: string) {
    return this.prisma.subscription_features.findMany({
      where: { subscription_id: subscriptionId },
      include: { features: true },
    });
  }

  async remove(id: string) {
    // Read the owning tenant before the row is gone — revoking access has to drop
    // their cache too, or the module stays reachable until the TTL lapses.
    const existing = await this.prisma.subscription_features.findUnique({
      where: { id },
      include: { subscriptions: { select: { tenant_id: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Subscription feature with ID "${id}" not found`);
    }

    const deleted = await this.prisma.subscription_features.delete({ where: { id } });

    await this.invalidateTenant(existing.subscriptions?.tenant_id);

    return deleted;
  }

  private async invalidateTenant(tenantId: string | null | undefined): Promise<void> {
    if (!tenantId) return;
    await this.addonService.invalidateAddonCache(tenantId);
  }
}
