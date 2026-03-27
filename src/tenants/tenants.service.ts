import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
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

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  update(id: string, updateTenantDto: UpdateTenantDto) {
    return this.prisma.tenants.update({
      where: { id },
      data: updateTenantDto,
      include: { subscriptions: { include: { plans_subscriptions_plan_idToplans: true } } },
    });
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
    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const data: any = {
      name: createCompanyDto.name,
      status: 'trial',
      name_en: createCompanyDto.nameEn,
      property_type: createCompanyDto.propertyType,
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
    const propertyCode = createCompanyDto.name
      .substring(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, 'X')
      + String(Math.floor(Math.random() * 9000) + 1000);

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
    // Verify user has access to this tenant
    const userTenant = await this.prisma.userTenant.findUnique({
      where: {
        userId_tenantId: {
          userId,
          tenantId,
        },
      },
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
  }

  /**
   * Invite a user to a tenant with specified role
   */
  async inviteUserToTenant(invitedByUserId: string, inviteDto: InviteUserDto) {
    const { email, role, tenantId } = inviteDto;

    // Verify that the inviter has owner/admin role on this tenant
    const inviterTenant = await this.prisma.userTenant.findUnique({
      where: {
        userId_tenantId: {
          userId: invitedByUserId,
          tenantId,
        },
      },
    });

    if (!inviterTenant || !['owner', 'admin'].includes(inviterTenant.role)) {
      throw new ForbiddenException('You do not have permission to invite users to this tenant');
    }

    // Find or create user by email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found. They must register first.`);
    }

    // Check if user already has access to this tenant
    const existingAccess = await this.prisma.userTenant.findUnique({
      where: {
        userId_tenantId: {
          userId: user.id,
          tenantId,
        },
      },
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
  }
}
