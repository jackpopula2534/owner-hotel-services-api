import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

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
    const { propertyId, status, type, floor, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (propertyId) where.propertyId = propertyId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (floor) where.floor = parseInt(floor);
    if (search) {
      where.OR = [
        { number: { contains: search } },
        { description: { contains: search } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.room.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            property: true,
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
    } catch (error) {
      // ถ้าเกิด database error (เช่น table ไม่มี) ให้ส่ง empty array
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return {
            data: [],
            total: 0,
            page,
            limit,
          };
        }
      }
      throw error;
    }
  }

  async findOne(id: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const where: any = { id, tenantId };

    const room = await this.prisma.room.findFirst({
      where,
      include: {
        property: true,
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
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Verify property exists and belongs to tenant
    const propertyWhere: any = { id: createRoomDto.propertyId, tenantId };

    const property = await this.prisma.property.findFirst({
      where: propertyWhere,
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Check for duplicate room number within property
    const existingRoom = await this.prisma.room.findFirst({
      where: {
        propertyId: createRoomDto.propertyId,
        number: createRoomDto.number,
      },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Room with number ${createRoomDto.number} already exists in this property`,
      );
    }

    const data: any = { ...createRoomDto, tenantId };
    return this.prisma.room.create({
      data,
      include: { property: true },
    });
  }

  async update(id: string, updateRoomDto: UpdateRoomDto, tenantId?: string) {
    const room = await this.findOne(id, tenantId);

    if (updateRoomDto.number) {
      const existingRoom = await this.prisma.room.findFirst({
        where: {
          propertyId: room.propertyId,
          number: updateRoomDto.number,
          id: { not: id },
        },
      });
      if (existingRoom) {
        throw new BadRequestException(
          `Room with number ${updateRoomDto.number} already exists in this property`,
        );
      }
    }

    return this.prisma.room.update({
      where: { id },
      data: updateRoomDto,
      include: { property: true },
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

  async getAvailableRooms(checkIn: string, checkOut: string, propertyId?: string, tenantId?: string) {
    // ถ้าไม่มี tenantId (ผู้ใช้ใหม่) ให้ส่ง empty array กลับไป
    if (!tenantId) {
      return [];
    }

    try {
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);

      const bookingWhere: any = {
        tenantId,
        status: { in: ['confirmed', 'checked-in'] },
        OR: [
          { checkIn: { lte: checkOutDate }, checkOut: { gte: checkInDate } },
        ],
      };
      if (propertyId) bookingWhere.propertyId = propertyId;

      const conflictingBookings = await this.prisma.booking.findMany({
        where: bookingWhere,
        select: { roomId: true },
      });

      const occupiedRoomIds = conflictingBookings.map((b) => b.roomId);
      const roomWhere: any = { tenantId, status: 'available' };
      if (propertyId) roomWhere.propertyId = propertyId;
      if (occupiedRoomIds.length > 0) roomWhere.id = { notIn: occupiedRoomIds };

      const availableRooms = await this.prisma.room.findMany({
        where: roomWhere,
        include: { property: true },
        orderBy: { number: 'asc' },
      });

      return availableRooms;
    } catch (error) {
      // ถ้าเกิด database error ให้ส่ง empty array
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021' || error.code === 'P2022') {
          return [];
        }
      }
      throw error;
    }
  }
}

