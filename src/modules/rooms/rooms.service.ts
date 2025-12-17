import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, status, type, floor, search } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
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
        take: parseInt(limit),
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
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
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

  async create(createRoomDto: CreateRoomDto) {
    // Check if room number already exists
    const existingRoom = await this.prisma.room.findUnique({
      where: { number: createRoomDto.number },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Room with number ${createRoomDto.number} already exists`,
      );
    }

    return this.prisma.room.create({
      data: createRoomDto,
    });
  }

  async update(id: string, updateRoomDto: UpdateRoomDto) {
    await this.findOne(id); // Check if exists

    // If updating number, check for duplicates
    if (updateRoomDto.number) {
      const existingRoom = await this.prisma.room.findUnique({
        where: { number: updateRoomDto.number },
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

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    // Check if room has active bookings
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

  async updateStatus(id: string, status: string) {
    await this.findOne(id);

    return this.prisma.room.update({
      where: { id },
      data: { status },
    });
  }

  async getAvailableRooms(checkIn: string, checkOut: string) {
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Find rooms with conflicting bookings
    const conflictingBookings = await this.prisma.booking.findMany({
      where: {
        status: { in: ['confirmed', 'checked-in'] },
        OR: [
          {
            checkIn: { lte: checkOutDate },
            checkOut: { gte: checkInDate },
          },
        ],
      },
      select: { roomId: true },
    });

    const occupiedRoomIds = conflictingBookings.map((b) => b.roomId);

    // Get available rooms
    const availableRooms = await this.prisma.room.findMany({
      where: {
        id: { notIn: occupiedRoomIds },
        status: 'available',
      },
      orderBy: { number: 'asc' },
    });

    return availableRooms;
  }
}

