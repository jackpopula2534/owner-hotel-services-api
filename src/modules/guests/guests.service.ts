import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GuestsService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(tenantId: string | undefined, search?: string) {
    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
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
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(tenantId, search);

    const [data, total] = await Promise.all([
      this.prisma.guest.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.guest.count({ where }),
    ]);

    return {
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const guest = await this.prisma.guest.findFirst({
      where,
      include: { bookings: true },
    });

    if (!guest) {
      throw new NotFoundException(`Guest with ID ${id} not found`);
    }

    return guest;
  }

  async create(createGuestDto: any, tenantId?: string) {
    const data: any = { ...createGuestDto };
    if (tenantId != null) data.tenantId = tenantId;
    return this.prisma.guest.create({
      data,
    });
  }

  async update(id: string, updateGuestDto: any, tenantId?: string) {
    await this.findOne(id, tenantId);

    const data: any = { ...updateGuestDto };
    return this.prisma.guest.update({
      where: { id },
      data,
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.guest.delete({
      where: { id },
    });
  }
}

