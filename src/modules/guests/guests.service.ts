import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GuestsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

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

  async findOne(id: string) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: { bookings: true },
    });

    if (!guest) {
      throw new NotFoundException(`Guest with ID ${id} not found`);
    }

    return guest;
  }

  async create(createGuestDto: any) {
    return this.prisma.guest.create({
      data: createGuestDto,
    });
  }

  async update(id: string, updateGuestDto: any) {
    await this.findOne(id); // Check if exists

    return this.prisma.guest.update({
      where: { id },
      data: updateGuestDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.guest.delete({
      where: { id },
    });
  }
}

