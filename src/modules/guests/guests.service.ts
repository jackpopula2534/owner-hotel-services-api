import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GuestsService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(tenantId: string, search?: string) {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }
    return where;
  }

  async findAll(query: any, tenantId?: string) {
    // ถ้าไม่มี tenantId (ผู้ใช้ใหม่) ให้ส่ง empty array กลับไป
    if (!tenantId) {
      return {
        data: [],
        total: 0,
        page: 1,
        limit: parseInt(query.limit) || 10,
      };
    }

    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const search = query.search;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(tenantId, search);

    try {
      const [data, total] = await Promise.all([
        this.prisma.guest.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.guest.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      // Handle Prisma errors (e.g., P2021: table not exist)
      if (error.code === 'P2021' || error.code === 'P2022') {
        return {
          data: [],
          total: 0,
          page,
          limit,
        };
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

    try {
      const guest = await this.prisma.guest.findFirst({
        where,
        include: { bookings: true },
      });

      if (!guest) {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }

      return guest;
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }

  async create(createGuestDto: any, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const data: any = { ...createGuestDto, tenantId };

    try {
      return await this.prisma.guest.create({
        data,
      });
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new BadRequestException('Guest table does not exist. Please contact administrator.');
      }
      throw error;
    }
  }

  async update(id: string, updateGuestDto: any, tenantId?: string) {
    await this.findOne(id, tenantId);

    const data: any = { ...updateGuestDto };

    try {
      return await this.prisma.guest.update({
        where: { id },
        data,
      });
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    try {
      return await this.prisma.guest.delete({
        where: { id },
      });
    } catch (error) {
      // Handle Prisma errors
      if (error.code === 'P2021' || error.code === 'P2022') {
        throw new NotFoundException(`Guest with ID ${id} not found`);
      }
      throw error;
    }
  }
}
