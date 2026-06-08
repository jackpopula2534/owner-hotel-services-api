import { Injectable } from '@nestjs/common';
import { AddonService } from '../addons/addon.service';
import { CORE_SUB_SYSTEMS, type SubSystemCard } from './sub-systems.catalog';

export interface SubSystemsResponse {
  success: true;
  data: {
    available: SubSystemCard[];
    locked: SubSystemCard[];
    all: SubSystemCard[];
    counts: { available: number; locked: number; total: number };
  };
}

@Injectable()
export class SubSystemsService {
  constructor(private readonly addonService: AddonService) {}

  /**
   * Build the Sub Systems page cards for a tenant.
   *
   * Data-driven: cards come from add-ons flagged `is_sub_system = 1`
   * (metadata in `sub_system_meta`), plus core terminals. Availability is
   * resolved from the tenant's active add-ons.
   */
  async getForTenant(tenantId: string): Promise<SubSystemsResponse> {
    const [subSystemAddons, activeAddons] = await Promise.all([
      this.addonService.getSubSystemAddons(),
      tenantId ? this.addonService.getActiveAddons(tenantId) : Promise.resolve([]),
    ]);
    const activeCodes = new Set(activeAddons.filter((a) => a.isActive).map((a) => a.code));

    // Core terminals first (always available)
    const all: SubSystemCard[] = [...CORE_SUB_SYSTEMS];

    // Add-on-driven cards (one add-on may expose several cards)
    for (const addon of subSystemAddons) {
      const cards = addon.subSystemMeta ?? [];
      const available = activeCodes.has(addon.code);
      for (const meta of cards) {
        all.push({
          ...meta,
          name: meta.name ?? addon.name,
          description: meta.description ?? addon.description ?? '',
          icon: meta.icon ?? addon.icon ?? 'Box',
          requiredAddon: addon.code,
          available,
          status: available ? 'ready' : 'locked',
        });
      }
    }

    all.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

    const available = all.filter((c) => c.available);
    const locked = all.filter((c) => !c.available);

    return {
      success: true,
      data: {
        available,
        locked,
        all,
        counts: { available: available.length, locked: locked.length, total: all.length },
      },
    };
  }
}
