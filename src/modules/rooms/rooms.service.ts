import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, type, floor, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (floor) where.floor = parseInt(floor);
    if (search) {
      where.OR = [
        { number: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          bookings: {
            where: {
              status: { in: ['confirmed', 'checked-in'] },
            },
          },
        },
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const room = await this.prisma.room.findFirst({
      where,
      include: {
        bookings: {
          include: {
            guest: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${id} not found`);
    }

    return room;
  }

  async create(createRoomDto: CreateRoomDto, tenantId?: string) {
    const scope: any = tenantId != null ? { tenantId } : {};
    const existingRoom = await this.prisma.room.findFirst({
      where: { ...scope, number: createRoomDto.number },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Room with number ${createRoomDto.number} already exists`,
      );
    }

    const data: any = { ...createRoomDto };
    if (tenantId != null) data.tenantId = tenantId;
    return this.prisma.room.create({
      data,
    });
  }

  async update(id: string, updateRoomDto: UpdateRoomDto, tenantId?: string) {
    await this.findOne(id, tenantId);

    if (updateRoomDto.number) {
      const scope: any = tenantId != null ? { tenantId } : {};
      const existingRoom = await this.prisma.room.findFirst({
        where: { ...scope, number: updateRoomDto.number },
      });
      if (existingRoom && existingRoom.id !== id) {
        throw new BadRequestException(
          `Room with number ${updateRoomDto.number} already exists`,
        );
      }
    }

    return this.prisma.room.update({
      where: { id },
      data: updateRoomDto,
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    const activeBookings = await this.prisma.booking.findFirst({
      where: {
        roomId: id,
        status: { in: ['confirmed', 'checked-in'] },
      },
    });

    if (activeBookings) {
      throw new BadRequestException(
        'Cannot delete room with active bookings',
      );
    }

    return this.prisma.room.delete({
      where: { id },
    });
  }

  async updateStatus(id: string, status: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.room.update({
      where: { id },
      data: { status },
    });
  }

  async getAvailableRooms(checkIn: string, checkOut: string, tenantId?: string) {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    const bookingWhere: any = {
      status: { in: ['confirmed', 'checked-in'] },
      OR: [
        { checkIn: { lte: checkOutDate }, checkOut: { gte: checkInDate } },
      ],
    };
    if (tenantId != null) bookingWhere.tenantId = tenantId;

    const conflictingBookings = await this.prisma.booking.findMany({
      where: bookingWhere,
      select: { roomId: true },
    });

    const occupiedRoomIds = conflictingBookings.map((b) => b.roomId);
    const roomWhere: any = { status: 'available' };
    if (tenantId != null) roomWhere.tenantId = tenantId;
    if (occupiedRoomIds.length > 0) roomWhere.id = { notIn: occupiedRoomIds };

    const availableRooms = await this.prisma.room.findMany({
      where: roomWhere,
      orderBy: { number: 'asc' },
    });

    return availableRooms;
  }
}

