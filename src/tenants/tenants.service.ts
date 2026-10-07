import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { PlanProductLine, planProductLine } from '../subscription/plan-change-policy';
import { InviteUserDto } from './dto/invite-user.dto';

export interface TenantWithUserRole {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  isDefault: boolean;
  joinedAt: string | Date;
  tenant: {
    id: string;
    name: string;
    status: string;
    /** Company profile — camelCase so the Owner Console form can edit it directly. */
    nameEn?: string | null;
    propertyType?: string | null;
    location?: string | null;
    roomCount?: number | null;
    website?: string | null;
    description?: string | null;
    customerName?: string | null;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    district?: string | null;
    province?: string | null;
    postalCode?: string | null;
    trialEndsAt?: string | Date | null;
    createdAt?: string | Date | null;
    subscription?: {
      id: string;
      status: string;
      plan?: {
        id: string;
        name: string;
        code: string;
      };
    };
  };
}

/** Minimal shape of `req.user` the tenant-update path needs. */
export interface TenantActor {
  userId?: string;
  role?: string;
  tenantId?: string;
  isPlatformAdmin?: boolean;
}

/**
 * Fields a tenant owner/admin may change on their own company via
 * PATCH /tenants/:id — DTO (camelCase) → prisma column (snake_case).
 * Anything not listed here (status, trial_ends_at, …) is silently dropped
 * for non-platform callers so a tenant can never re-activate itself.
 */
export const TENANT_SELF_EDITABLE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  name: 'name',
  nameEn: 'name_en',
  propertyType: 'property_type',
  location: 'location',
  roomCount: 'room_count',
  website: 'website',
  description: 'description',
  customerName: 'customer_name',
  taxId: 'tax_id',
  email: 'email',
  phone: 'phone',
  address: 'address',
  district: 'district',
  province: 'province',
  postalCode: 'postal_code',
});

/** Extra fields only a platform admin may set. */
export const TENANT_ADMIN_ONLY_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  status: 'status',
  trialEndsAt: 'trial_ends_at',
});

/**
 * `UserTenant.role` values that may edit the company profile. The junction
 * row is written with 'owner' (create-company / register / seeder), 'admin'
 * or 'member' (invite); 'tenant_admin' is accepted defensively because the
 * global User.role uses that spelling.
 */
export const TENANT_MANAGER_ROLES: ReadonlyArray<string> = Object.freeze([
  'owner',
  'admin',
  'tenant_admin',
]);


/** Mirrors onboarding: `tenants.property_type` remembers the tenant's product line. */
const PROPERTY_TYPE_BY_LINE: Record<PlanProductLine, string> = {
  HOTEL: 'hotel',
  CAMP: 'campground',
};

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  create(createTenantDto: CreateTenantDto & { trialEndsAt?: Date }) {
    const data: any = {
      name: createTenantDto.name,
      status: createTenantDto.status,
      room_count: createTenantDto.roomCount,
      name_en: createTenantDto.nameEn,
      property_type: createTenantDto.propertyType,
      location: createTenantDto.location,
      website: createTenantDto.website,
      description: createTenantDto.description,
      customer_name: createTenantDto.customerName,
      tax_id: createTenantDto.taxId,
      email: createTenantDto.email,
      phone: createTenantDto.phone,
      address: createTenantDto.address,
      district: createTenantDto.district,
      province: createTenantDto.province,
      postal_code: createTenantDto.postalCode,
      trial_ends_at: createTenantDto.trialEndsAt,
    };

    // Clean up undefined properties
    Object.keys(data).forEach((key) => {
      if (data[key] === undefined) {
        delete data[key];
      }
    });

    return this.prisma.tenants.create({
      data,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  findAll(tenantId?: string) {
    const where = tenantId ? { id: tenantId } : {};
    return this.prisma.tenants.findMany({
      where,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.tenants.findUnique({
      where: { id },
      include: {
        subscriptions: {
          include: {
            plans_subscriptions_plan_idToplans: true,
            subscription_features: { include: { features: true } },
          },
        },
      },
    });
  }

  /**
   * Update a tenant's company profile.
   *
   * Authorisation (when `actor` is given):
   *   • platform_admin → any tenant, may also set status / trialEndsAt
   *   • everyone else  → must hold an owner/admin `UserTenant` row for `id`
   *     (see assertCanManageTenant); only TENANT_SELF_EDITABLE_FIELDS apply.
   *
   * The DTO is camelCase while the `tenants` table is snake_case, so the
   * payload is always re-mapped through the whitelist — unknown keys never
   * reach Prisma.
   */
  async update(id: string, updateTenantDto: UpdateTenantDto, actor?: TenantActor) {
    const isPlatformAdmin =
      !actor || actor.role === 'platform_admin' || actor.isPlatformAdmin === true;

    if (!isPlatformAdmin) {
      await this.assertCanManageTenant(actor, id);
    }

    const data = this.toTenantUpdateData(updateTenantDto, isPlatformAdmin);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('ไม่มีข้อมูลที่แก้ไขได้ในคำขอนี้ (No updatable fields)');
    }

    return this.prisma.tenants.update({
      where: { id },
      data,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
  }

  /**
   * Map + whitelist an UpdateTenantDto into a prisma `tenants` update payload.
   * Empty strings on optional columns are stored as NULL so the owner can
   * clear a field from the form.
   */
  toTenantUpdateData(dto: UpdateTenantDto, includeAdminFields = false): Record<string, unknown> {
    const allowed: Record<string, string> = includeAdminFields
      ? { ...TENANT_SELF_EDITABLE_FIELDS, ...TENANT_ADMIN_ONLY_FIELDS }
      : { ...TENANT_SELF_EDITABLE_FIELDS };

    const data: Record<string, unknown> = {};
    const source = (dto ?? {}) as Record<string, unknown>;

    for (const [dtoKey, column] of Object.entries(allowed)) {
      const value = source[dtoKey];
      if (value === undefined) continue;

      if (dtoKey === 'name') {
        const name = typeof value === 'string' ? value.trim() : '';
        if (!name) {
          throw new BadRequestException('ชื่อกิจการต้องไม่ว่าง (name is required)');
        }
        data[column] = name;
        continue;
      }

      if (dtoKey === 'roomCount') {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new BadRequestException('จำนวนห้องต้องเป็นจำนวนเต็มไม่ติดลบ');
        }
        data[column] = n;
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        data[column] = trimmed === '' ? null : trimmed;
        continue;
      }

      data[column] = value;
    }

    return data;
  }

  /**
   * Ensure `actor` may manage tenant `tenantId`.
   *
   * Primary rule: a `UserTenant` row for (actor.userId, tenantId) whose role
   * is in TENANT_MANAGER_ROLES. A row with any other role (e.g. 'member') is
   * an explicit denial.
   *
   * Legacy fallback: tenants created through the hotel-management flow have
   * no junction row for their tenant_admin. For those we accept a
   * tenant_admin whose JWT tenantId equals `tenantId` — the JWT tenantId is
   * only ever set from User.tenantId (registration) or after a validated
   * switch, so it cannot be forged from the client.
   */
  async assertCanManageTenant(actor: TenantActor | undefined, tenantId: string): Promise<void> {
    const userId = actor?.userId;
    if (!userId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขข้อมูลกิจการนี้');
    }

    const membership = await this.tenantContext.runUnscoped(() =>
      this.prisma.userTenant.findFirst({
        where: { userId, tenantId },
        select: { role: true },
      }),
    );

    if (membership) {
      if (TENANT_MANAGER_ROLES.includes(membership.role)) return;
      throw new ForbiddenException(
        'เฉพาะเจ้าของกิจการหรือผู้ดูแลเท่านั้นที่แก้ไขข้อมูลกิจการได้',
      );
    }

    if (actor?.role === 'tenant_admin' && actor.tenantId && actor.tenantId === tenantId) {
      return;
    }

    throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขข้อมูลกิจการนี้');
  }

  remove(id: string) {
    return this.prisma.tenants.delete({
      where: { id },
    });
  }

  /**
   * Create an additional company/tenant for an existing user
   * Each tenant must have its own subscription
   */
  async createAdditionalTenant(userId: string, createCompanyDto: CreateCompanyDto) {
    if (!userId) {
      throw new BadRequestException('User ID is required to create a company');
    }

    // Creating a brand-new tenant is inherently a cross-tenant operation:
    //   • the user lookup is keyed by global user id (User is tenant-scoped, so
    //     findUnique() is rejected by the TenantScope middleware)
    //   • the new tenants/userTenant/property rows must be written under the
    //     NEW tenant's id, not the caller's currently-active tenant.
    // We therefore run the whole flow unscoped and take responsibility for
    // setting tenantId explicitly on every write below.
    return this.tenantContext.runUnscoped(async () => {
      // Verify user exists (findFirst — findUnique is blocked on scoped models)
      const user = await this.prisma.user.findFirst({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // 1 account = 1 product line: an extra company (e.g. another hotel
      // branch) stays on the line the user already runs. A user who wants the
      // other line registers a new account instead.
      const userLine = await this.resolveUserProductLine(userId);
      const requestedType = createCompanyDto.propertyType?.trim().toLowerCase();
      if (userLine && requestedType) {
        const requestedLine: PlanProductLine = requestedType === 'campground' ? 'CAMP' : 'HOTEL';
        if (requestedLine !== userLine) {
          throw new BadRequestException({
            code: 'CROSS_PRODUCT_LINE',
            message:
              'บริษัทที่สร้างเพิ่มต้องเป็นธุรกิจประเภทเดียวกับบัญชีนี้ — หากต้องการใช้อีกระบบ กรุณาสมัครบัญชีใหม่',
            details: { currentLine: userLine, requestedLine },
          });
        }
      }
      const propertyType = userLine
        ? PROPERTY_TYPE_BY_LINE[userLine]
        : createCompanyDto.propertyType;

      const data: any = {
        name: createCompanyDto.name,
        status: 'trial',
        name_en: createCompanyDto.nameEn,
        property_type: propertyType,
        location: createCompanyDto.location,
        website: createCompanyDto.website,
        description: createCompanyDto.description,
        customer_name: createCompanyDto.customerName,
        tax_id: createCompanyDto.taxId,
        email: createCompanyDto.email,
        phone: createCompanyDto.phone,
        address: createCompanyDto.address,
        district: createCompanyDto.district,
        province: createCompanyDto.province,
        postal_code: createCompanyDto.postalCode,
      };

      // Clean up undefined properties
      Object.keys(data).forEach((key) => {
        if (data[key] === undefined) {
          delete data[key];
        }
      });

      const newTenant = await this.prisma.tenants.create({
        data,
      });

      // Create UserTenant junction record with owner role
      await this.prisma.userTenant.create({
        data: {
          userId,
          tenantId: newTenant.id,
          role: 'owner',
          isDefault: false,
        },
      });

      // Create default property for this tenant so rooms/bookings can work
      const propertyCode =
        createCompanyDto.name
          .substring(0, 3)
          .toUpperCase()
          .replace(/[^A-Z]/g, 'X') + String(Math.floor(Math.random() * 9000) + 1000);

      const defaultProperty = await this.prisma.property.create({
        data: {
          tenantId: newTenant.id,
          name: createCompanyDto.name,
          code: propertyCode,
          location: createCompanyDto.location ?? null,
          phone: createCompanyDto.phone ?? null,
          email: createCompanyDto.email ?? null,
          isDefault: true,
          status: 'active',
        },
      });

      return { ...newTenant, property: defaultProperty };
    });
  }

  /**
   * The product line of the companies a user already belongs to — the latest
   * subscription's plan wins, `tenants.property_type` covers a company that
   * has no subscription yet. Null for a user with no company at all.
   */
  private async resolveUserProductLine(userId: string): Promise<PlanProductLine | null> {
    const memberships = await this.prisma.userTenant.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        tenant: {
          select: {
            property_type: true,
            subscriptions: {
              orderBy: { created_at: 'desc' },
              take: 1,
              select: {
                plans_subscriptions_plan_idToplans: { select: { code: true, system: true } },
              },
            },
          },
        },
      },
    });

    for (const membership of memberships) {
      const plan = membership.tenant?.subscriptions?.[0]?.plans_subscriptions_plan_idToplans;
      if (plan) return planProductLine(plan);
    }
    for (const membership of memberships) {
      const type = membership.tenant?.property_type?.toLowerCase();
      if (type) return type === 'campground' ? 'CAMP' : 'HOTEL';
    }
    return null;
  }

  /**
   * Get all tenants for a given user (via user_tenants junction table)
   */
  async getUserTenants(userId: string): Promise<TenantWithUserRole[]> {
    if (!userId) {
      throw new BadRequestException('User ID is required to fetch tenants');
    }

    const userTenants = await this.prisma.userTenant.findMany({
      where: { userId },
      include: {
        tenant: {
          include: {
            subscriptions: {
              orderBy: { created_at: 'desc' }, // [0] = latest subscription
              include: {
                plans_subscriptions_plan_idToplans: true,
              },
            },
          },
        },
      },
    });

    return userTenants.map((ut) => {
      const subscription = ut.tenant?.subscriptions?.[0];
      const plan = subscription?.plans_subscriptions_plan_idToplans;

      return {
        id: ut.id,
        userId: ut.userId,
        tenantId: ut.tenantId,
        role: ut.role || 'member',
        isDefault: ut.isDefault ?? false,
        joinedAt: ut.joinedAt || ut.createdAt || new Date(),
        tenant: {
          id: ut.tenant?.id || '',
          name: ut.tenant?.name || '',
          status: ut.tenant?.status || 'active',
          nameEn: ut.tenant?.name_en ?? null,
          propertyType: ut.tenant?.property_type ?? null,
          location: ut.tenant?.location ?? null,
          roomCount: ut.tenant?.room_count ?? null,
          website: ut.tenant?.website ?? null,
          description: ut.tenant?.description ?? null,
          customerName: ut.tenant?.customer_name ?? null,
          taxId: ut.tenant?.tax_id ?? null,
          email: ut.tenant?.email ?? null,
          phone: ut.tenant?.phone ?? null,
          address: ut.tenant?.address ?? null,
          district: ut.tenant?.district ?? null,
          province: ut.tenant?.province ?? null,
          postalCode: ut.tenant?.postal_code ?? null,
          trialEndsAt: ut.tenant?.trial_ends_at ?? null,
          createdAt: ut.tenant?.created_at ?? null,
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                plan: plan
                  ? {
                      id: plan.id,
                      name: plan.name,
                      code: plan.code || '',
                    }
                  : undefined,
              }
            : undefined,
        },
      };
    });
  }

  /**
   * Switch user's active tenant
   * Validates that user has access to the tenant via user_tenants
   */
  async switchTenant(userId: string, tenantId: string) {
    // Switching the active tenant is inherently cross-tenant: the userTenant
    // access row and the user's activeTenantId live outside the caller's
    // currently-active scope. Run unscoped and set tenantId explicitly.
    return this.tenantContext.runUnscoped(async () => {
      // Verify user has access to this tenant (findFirst — findUnique is blocked
      // on tenant-scoped models by the TenantScope middleware)
      const userTenant = await this.prisma.userTenant.findFirst({
        where: { userId, tenantId },
      });

      if (!userTenant) {
        throw new ForbiddenException('You do not have access to this tenant');
      }

      // Update user's activeTenantId
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { tenantId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          tenantId: true,
        },
      });

      return {
        user: updatedUser,
        message: 'Tenant switched successfully',
      };
    });
  }

  /**
   * Invite a user to a tenant with specified role
   */
  async inviteUserToTenant(invitedByUserId: string, inviteDto: InviteUserDto) {
    const { email, role, tenantId } = inviteDto;

    // Inviting spans tenants: the inviter's access row, the invitee lookup by
    // global email, and the new access row all sit outside the caller's active
    // scope. Run unscoped and set tenantId explicitly on the write.
    return this.tenantContext.runUnscoped(async () => {
      // Verify that the inviter has owner/admin role on this tenant (findFirst —
      // findUnique is blocked on tenant-scoped models by the TenantScope middleware)
      const inviterTenant = await this.prisma.userTenant.findFirst({
        where: { userId: invitedByUserId, tenantId },
      });

      if (!inviterTenant || !['owner', 'admin'].includes(inviterTenant.role)) {
        throw new ForbiddenException('You do not have permission to invite users to this tenant');
      }

      // Find user by global email
      const user = await this.prisma.user.findFirst({
        where: { email },
      });

      if (!user) {
        throw new NotFoundException(`User with email ${email} not found. They must register first.`);
      }

      // Check if user already has access to this tenant
      const existingAccess = await this.prisma.userTenant.findFirst({
        where: { userId: user.id, tenantId },
      });

      if (existingAccess) {
        throw new BadRequestException('User already has access to this tenant');
      }

      // Create UserTenant record
      const userTenant = await this.prisma.userTenant.create({
        data: {
          userId: user.id,
          tenantId,
          role: role || 'member',
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return userTenant;
    });
  }
}
