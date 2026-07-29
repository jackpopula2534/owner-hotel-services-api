import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AddonService } from '@/modules/addons/addon.service';
import {
  INTEGRATIONS,
  IntegrationDef,
  IntegrationGroup,
  findGroup,
  findIntegration,
} from './integrations.catalog';

export interface IntegrationStatus {
  key: string;
  name: string;
  description: string;
  /** Page section this connection belongs to (from INTEGRATION_GROUPS). */
  group: IntegrationGroup;
  source: { key: string; name: string };
  target: { key: string; name: string };
  icon: string;
  requiredAddons: string[];
  /** Add-ons that are required but NOT active for this tenant. */
  missingAddons: string[];
  /** All required add-ons are active → the connection can be turned on. */
  available: boolean;
  /** Effective on/off (false whenever not available). */
  enabled: boolean;
  /** When the tenant last turned it on, or null. */
  connectedAt: Date | null;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addonService: AddonService,
  ) {}

  /** Add-on codes from the definition that the tenant does NOT currently hold. */
  private async missingAddons(tenantId: string, def: IntegrationDef): Promise<string[]> {
    const missing: string[] = [];
    for (const code of def.requiredAddons) {
      const has = await this.addonService.hasActiveAddon(tenantId, code);
      if (!has) missing.push(code);
    }
    return missing;
  }

  /**
   * List every catalogued integration with this tenant's availability + on/off
   * state. Used by the Integration Hub settings page.
   */
  async list(tenantId: string): Promise<IntegrationStatus[]> {
    const rows = await this.prisma.tenantIntegration.findMany({ where: { tenantId } });
    const byKey = new Map(rows.map((r) => [r.integrationKey, r]));

    const result: IntegrationStatus[] = [];
    for (const def of INTEGRATIONS) {
      const missing = await this.missingAddons(tenantId, def);
      const available = missing.length === 0;
      const row = byKey.get(def.key);
      const stored = row ? row.enabled : def.defaultEnabled;
      result.push({
        key: def.key,
        name: def.name,
        description: def.description,
        // Catalog groups are static — every def.group key exists in INTEGRATION_GROUPS.
        group: findGroup(def.group) as IntegrationGroup,
        source: def.source,
        target: def.target,
        icon: def.icon,
        requiredAddons: def.requiredAddons,
        missingAddons: missing,
        available,
        enabled: available && stored,
        connectedAt: row?.connectedAt ?? null,
      });
    }
    return result;
  }

  /**
   * Authoritative runtime gate consumed by event listeners. Returns true only
   * when the connection is both available (add-ons active) AND turned on
   * (explicit setting, or catalog default when unset).
   */
  async isEnabled(tenantId: string, key: string): Promise<boolean> {
    const def = findIntegration(key);
    if (!def) return false;

    const missing = await this.missingAddons(tenantId, def);
    if (missing.length > 0) return false;

    const row = await this.prisma.tenantIntegration.findFirst({
      where: { tenantId, integrationKey: key },
      select: { enabled: true },
    });
    return row ? row.enabled : def.defaultEnabled;
  }

  /**
   * Turn a connection on/off for a tenant. Enabling requires all add-ons to be
   * active (permission check). Tenant-scoped: we look the row up with findFirst
   * then update by id / create (never findUnique, per project rule).
   */
  async setEnabled(tenantId: string, key: string, enabled: boolean): Promise<IntegrationStatus> {
    const def = findIntegration(key);
    if (!def) throw new NotFoundException(`Unknown integration "${key}"`);

    if (enabled) {
      const missing = await this.missingAddons(tenantId, def);
      if (missing.length > 0) {
        throw new ForbiddenException(
          `เปิดการเชื่อมต่อไม่ได้ — ต้องมี add-on: ${missing.join(', ')}`,
        );
      }
    }

    const existing = await this.prisma.tenantIntegration.findFirst({
      where: { tenantId, integrationKey: key },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.tenantIntegration.update({
        where: { id: existing.id },
        data: { enabled, connectedAt: enabled ? new Date() : null },
      });
    } else {
      await this.prisma.tenantIntegration.create({
        data: {
          tenantId,
          integrationKey: key,
          enabled,
          connectedAt: enabled ? new Date() : null,
        },
      });
    }

    this.logger.log(
      `Tenant ${tenantId} ${enabled ? 'enabled' : 'disabled'} integration "${key}"`,
    );

    const all = await this.list(tenantId);
    // list() always contains def.key, so this is safe.
    return all.find((i) => i.key === key) as IntegrationStatus;
  }
}
