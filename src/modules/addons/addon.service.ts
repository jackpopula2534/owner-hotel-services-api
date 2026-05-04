import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CacheService } from '@/cache/cache.service';
import { CreateAddonDto, AddonBillingCycle } from './dto/create-addon.dto';
import { UpdateAddonDto } from './dto/update-addon.dto';
import { QueryAddonDto } from './dto/query-addon.dto';

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

/**
 * Public-facing AddOn entity (response shape)
 */
export interface AddonEntity {
  id: string;
  code: string;
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
        icon: dto.icon ?? null,
        display_order: dto.displayOrder ?? 0,
        min_quantity: dto.minQuantity ?? 1,
        max_quantity: dto.maxQuantity ?? 1,
        is_active: dto.isActive === false ? 0 : 1,
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
    if (dto.icon !== undefined) data.icon = dto.icon ?? null;
    if (dto.displayOrder !== undefined) data.display_order = dto.displayOrder;
    if (dto.minQuantity !== undefined) data.min_quantity = dto.minQuantity;
    if (dto.maxQuantity !== undefined) data.max_quantity = dto.maxQuantity;
    if (dto.isActive !== undefined) data.is_active = dto.isActive ? 1 : 0;

    const updated = await this.addOnsClient().update({ where: { id }, data });
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
      icon: dto.icon ?? null,
      display_order: dto.displayOrder ?? 0,
      min_quantity: dto.minQuantity ?? 1,
      max_quantity: dto.maxQuantity ?? 1,
      is_active: dto.isActive === false ? 0 : 1,
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
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  });
}

interface AddonRecord {
  id: string;
  code: string;
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
  created_at: Date;
  updated_at: Date;
}
