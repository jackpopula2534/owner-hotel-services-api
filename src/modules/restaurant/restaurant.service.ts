import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RestaurantService {
  private readonly logger = new Logger(RestaurantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: { page?: number; limit?: number; search?: string; isActive?: string },
    tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { page = 1, limit = 10, search, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { tenantId };

    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { description: { contains: search } },
        { location: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      (this.prisma.restaurant as any).findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { tables: true, menuCategories: true, orders: true } },
        },
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const restaurant = await (this.prisma.restaurant as any).findFirst({
      where: { id, tenantId },
      include: {
        tables: {
          where: { isActive: true },
          orderBy: { tableNumber: 'asc' },
        },
        menuCategories: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            items: {
              where: { isAvailable: true },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${id} not found`);
    }

    return restaurant;
  }

  async create(createRestaurantDto: CreateRestaurantDto, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const existing = await this.prisma.restaurant.findFirst({
      where: { code: createRestaurantDto.code, tenantId },
    });

    if (existing) {
      throw new BadRequestException(
        `Restaurant with code '${createRestaurantDto.code}' already exists`,
      );
    }

    const { layoutData, ...rest } = createRestaurantDto;

    return this.prisma.restaurant.create({
      data: {
        ...rest,
        tenantId,
        ...(layoutData !== undefined && { layoutData: layoutData as any }),
      },
    });
  }

  async update(id: string, updateRestaurantDto: UpdateRestaurantDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    const { layoutData, ...rest } = updateRestaurantDto;

    return this.prisma.restaurant.update({
      where: { id },
      data: {
        ...rest,
        ...(layoutData !== undefined && { layoutData: layoutData as any }),
      },
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.restaurant.delete({ where: { id } });
  }
}
