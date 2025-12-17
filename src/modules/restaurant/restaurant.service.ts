import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Injectable()
export class RestaurantService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.restaurant.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.restaurant.count({ where }),
    ]);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${id} not found`);
    }

    return restaurant;
  }

  async create(createRestaurantDto: CreateRestaurantDto) {
    return this.prisma.restaurant.create({
      data: createRestaurantDto,
    });
  }

  async update(id: string, updateRestaurantDto: UpdateRestaurantDto) {
    await this.findOne(id); // Check if exists

    return this.prisma.restaurant.update({
      where: { id },
      data: updateRestaurantDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.restaurant.delete({
      where: { id },
    });
  }
}

