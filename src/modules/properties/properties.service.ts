import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(tenantId: string, search?: string, includeDeleted = false) {
    const where: any = { tenantId };
    if (!includeDeleted) {
      where.deletedAt = null;
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { location: { contains: search } },
      ];
    }
    return where;
  }

  async findAll(query: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, search } = query;
    const skip = (page - 1) * limit;

    const includeDeleted = query.includeDeleted === 'true' || query.includeDeleted === '1';
    const onlyDeleted = query.onlyDeleted === 'true' || query.onlyDeleted === '1';

    const where = this.buildWhere(tenantId, search, includeDeleted || onlyDeleted);
    if (onlyDeleted) {
      where.deletedAt = { not: null };
    }
    if (status) where.status = status;

    const [data, total, roomsCurrent, usersCurrent] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: { rooms: true, bookings: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.property.count({ where }),
      this.prisma.room.count({ where: { tenantId } }),
      this.prisma.userTenant.count({ where: { tenantId } }),
    ]);

    // Build usage object from subscription plan
    const usage = await this.getUsageData(tenantId, total, roomsCurrent, usersCurrent);

    return {
      data,
      total,
      page,
      limit,
      usage,
    };
  }

  private async getUsageData(
    tenantId: string,
    propertyCurrent: number,
    roomsCurrent: number,
    usersCurrent: number,
  ) {
    const subscription = await this.prisma.subscriptions.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ['trial', 'active'] },
      },
      include: {
        plans_subscriptions_plan_idToplans: true,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!subscription) {
      return {
        current: propertyCurrent,
        max: 1,
        addOns: 0,
        totalLimit: 1,
        roomsCurrent,
        roomsMax: 0,
        usersCurrent,
        usersMax: 0,
      };
    }

    const plan = subscription.plans_subscriptions_plan_idToplans;

    // Check property add-ons
    const propertyAddOns = await this.prisma.subscription_features.findMany({
      where: {
        subscription_id: subscription.id,
        is_active: 1,
        features: { code: 'additional_properties', is_active: 1 },
      },
      include: { features: true },
    });
    const addOns = propertyAddOns.reduce((sum, addon) => sum + (addon.quantity || 0), 0);

    return {
      current: propertyCurrent,
      max: Number(plan.max_properties),
      addOns,
      totalLimit: Number(plan.max_properties) + addOns,
      roomsCurrent,
      roomsMax: Number(plan.max_rooms),
      usersCurrent,
      usersMax: Number(plan.max_users),
    };
  }

  async findOne(id: string, tenantId?: string, includeDeleted = false) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };
    if (!includeDeleted) {
      where.deletedAt = null;
    }

    const property = await this.prisma.property.findFirst({
      where,
      include: {
        _count: {
          select: { rooms: true, bookings: true },
        },
      },
    });

    if (!property) {
      throw new NotFoundException(`Property with ID ${id} not found`);
    }

    // Build detailed statistics filtered by tenantId + propertyId
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const roomWhere = { tenantId, propertyId: id };

    const [
      totalRooms,
      availableRooms,
      occupiedRooms,
      maintenanceRooms,
      cleaningRooms,
      monthlyBookings,
      monthlyRevenue,
      todayCheckIns,
      todayCheckOuts,
      totalUsers,
    ] = await Promise.all([
      this.prisma.room.count({ where: roomWhere }),
      this.prisma.room.count({ where: { ...roomWhere, status: 'available' } }),
      this.prisma.room.count({ where: { ...roomWhere, status: 'occupied' } }),
      this.prisma.room.count({ where: { ...roomWhere, status: { in: ['maintenance', 'out_of_order'] } } }),
      this.prisma.room.count({ where: { ...roomWhere, status: 'cleaning' } }),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          createdAt: { gte: firstDayOfMonth },
          status: { not: 'cancelled' },
        },
      }),
      this.prisma.booking
        .aggregate({
          where: {
            tenantId,
            propertyId: id,
            createdAt: { gte: firstDayOfMonth },
            status: { in: ['confirmed', 'checked-in', 'checked-out'] },
          },
          _sum: { totalPrice: true },
        })
        .then((r) => Number(r._sum.totalPrice ?? 0))
        .catch(() => 0),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          checkIn: { gte: today, lt: tomorrow },
          status: { in: ['confirmed', 'pending'] },
        },
      }),
      this.prisma.booking.count({
        where: {
          tenantId,
          propertyId: id,
          checkOut: { gte: today, lt: tomorrow },
          status: 'checked-in',
        },
      }),
      this.prisma.userTenant.count({ where: { tenantId } }).catch(() => 0),
    ]);

    const roomUsagePercent = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    return {
      ...property,
      statistics: {
        roomCount: totalRooms,
        availableRooms,
        usedRooms: occupiedRooms,
        maintenanceRooms,
        cleaningRooms,
        roomUsagePercent,
        monthlyBookings,
        totalRevenue: monthlyRevenue,
        avgDailyRate: monthlyBookings > 0 ? Math.round(monthlyRevenue / monthlyBookings) : 0,
        totalUsers,
        activeUsers: 0,
        todayCheckIns,
        todayCheckOuts,
      },
    };
  }

  async create(createPropertyDto: CreatePropertyDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check property limit based on subscription plan
    await this.checkPropertyLimit(tenantId);

    // Check for duplicate code within tenant (exclude soft-deleted)
    const existing = await this.prisma.property.findFirst({
      where: {
        tenantId,
        code: createPropertyDto.code,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException(`Property with code ${createPropertyDto.code} already exists`);
    }

    const data: any = { ...createPropertyDto, tenantId };
    return this.prisma.property.create({ data });
  }

  private async checkPropertyLimit(tenantId: string): Promise<void> {
    // Get current property count (exclude soft-deleted)
    const currentPropertyCount = await this.prisma.property.count({
      where: { tenantId, deletedAt: null },
    });

    // Get tenant's active subscription with plan
    const subscription = await this.prisma.subscriptions.findFirst({
      where: {
        tenant_id: tenantId,
        status: { in: ['trial', 'active'] },
      },
      include: {
        plans_subscriptions_plan_idToplans: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    if (!subscription) {
      throw new BadRequestException(
        'No active subscription found. Please subscribe to a plan first.',
      );
    }

    const plan = subscription.plans_subscriptions_plan_idToplans;
    let maxProperties = plan.max_properties;

    // Check for property add-on features
    const propertyAddOns = await this.prisma.subscription_features.findMany({
      where: {
        subscription_id: subscription.id,
        is_active: 1,
        features: {
          code: 'additional_properties',
          is_active: 1,
        },
      },
      include: {
        features: true,
      },
    });

    // Add quantity from add-ons to max properties
    const addOnProperties = propertyAddOns.reduce((sum, addon) => sum + (addon.quantity || 0), 0);
    maxProperties += addOnProperties;

    // Check if limit is reached
    if (currentPropertyCount >= maxProperties) {
      throw new BadRequestException(
        `Property limit reached. Your current plan allows ${plan.max_properties} ${
          plan.max_properties === 1 ? 'property' : 'properties'
        }${
          addOnProperties > 0 ? ` + ${addOnProperties} from add-ons (total: ${maxProperties})` : ''
        }. Please upgrade your plan or purchase additional property add-ons.`,
      );
    }
  }

  async update(id: string, updatePropertyDto: UpdatePropertyDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    await this.findOne(id, tenantId);

    if (updatePropertyDto.code) {
      const existing = await this.prisma.property.findFirst({
        where: {
          tenantId,
          code: updatePropertyDto.code,
          id: { not: id },
          deletedAt: null,
        },
      });

      if (existing) {
        throw new BadRequestException(
          `Property with code ${updatePropertyDto.code} already exists`,
        );
      }
    }

    return this.prisma.property.update({
      where: { id },
      data: updatePropertyDto,
    });
  }

  async remove(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const property = await this.findOne(id, tenantId);

    // Soft delete — set deletedAt timestamp instead of hard delete
    return this.prisma.property.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'deleted',
      },
    });
  }

  async restore(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Find including deleted records
    const property = await this.findOne(id, tenantId, true);

    if (!property.deletedAt) {
      throw new BadRequestException('Property is not deleted');
    }

    return this.prisma.property.update({
      where: { id },
      data: {
        deletedAt: null,
        status: 'active',
      },
    });
  }
}
