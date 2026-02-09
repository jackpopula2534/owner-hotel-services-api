import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(tenantId: string, search?: string) {
    const where: any = { tenantId };
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

    const where = this.buildWhere(tenantId, search);
    if (status) where.status = status;

    const [data, total] = await Promise.all([
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
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

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

    return property;
  }

  async create(createPropertyDto: CreatePropertyDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Check property limit based on subscription plan
    await this.checkPropertyLimit(tenantId);

    // Check for duplicate code within tenant
    const existing = await this.prisma.property.findFirst({
      where: {
        tenantId,
        code: createPropertyDto.code,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `Property with code ${createPropertyDto.code} already exists`,
      );
    }

    const data: any = { ...createPropertyDto, tenantId };
    return this.prisma.property.create({ data });
  }

  private async checkPropertyLimit(tenantId: string): Promise<void> {
    // Get current property count
    const currentPropertyCount = await this.prisma.property.count({
      where: { tenantId },
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
    const addOnProperties = propertyAddOns.reduce(
      (sum, addon) => sum + (addon.quantity || 0),
      0,
    );
    maxProperties += addOnProperties;

    // Check if limit is reached
    if (currentPropertyCount >= maxProperties) {
      throw new BadRequestException(
        `Property limit reached. Your current plan allows ${plan.max_properties} ${
          plan.max_properties === 1 ? 'property' : 'properties'
        }${
          addOnProperties > 0
            ? ` + ${addOnProperties} from add-ons (total: ${maxProperties})`
            : ''
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

    await this.findOne(id, tenantId);

    // Check for active rooms
    const roomCount = await this.prisma.room.count({
      where: { propertyId: id },
    });

    if (roomCount > 0) {
      throw new BadRequestException(
        'Cannot delete property with existing rooms. Please delete or reassign rooms first.',
      );
    }

    return this.prisma.property.delete({
      where: { id },
    });
  }
}
