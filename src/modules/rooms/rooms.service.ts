import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

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
      where.OR = [{ number: { contains: search } }, { description: { contains: search } }];
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

    // Auto-resolve propertyId from tenant's default property if not provided
    let resolvedPropertyId = createRoomDto.propertyId;

    if (!resolvedPropertyId) {
      const defaultProperty = await this.prisma.property.findFirst({
        where: { tenantId, isDefault: true },
      });

      if (!defaultProperty) {
        // Fallback: use any active property of the tenant
        const anyProperty = await this.prisma.property.findFirst({
          where: { tenantId, status: 'active' },
          orderBy: { createdAt: 'asc' },
        });

        if (!anyProperty) {
          throw new NotFoundException(
            'No property found for this tenant. Please create a property first.',
          );
        }
        resolvedPropertyId = anyProperty.id;
      } else {
        resolvedPropertyId = defaultProperty.id;
      }
    }

    // Verify property exists and belongs to tenant
    const property = await this.prisma.property.findFirst({
      where: { id: resolvedPropertyId, tenantId },
    });

    if (!property) {
      // If we provided a propertyId but it wasn't found for this tenant,
      // try to fallback to the tenant's default or first property instead of failing.
      // This helps if the frontend has a stale or wrong propertyId.
      this.logger.warn(
        `Property ${resolvedPropertyId} not found for tenant ${tenantId}. Attempting fallback.`,
      );

      const fallbackProperty = await this.prisma.property.findFirst({
        where: { tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });

      if (!fallbackProperty) {
        throw new NotFoundException(
          `No property found for tenant ${tenantId}. Please create a property first.`,
        );
      }

      resolvedPropertyId = fallbackProperty.id;
      this.logger.log(`Falling back to property ${resolvedPropertyId}`);
    }

    // Check for duplicate room number within property
    const existingRoom = await this.prisma.room.findFirst({
      where: {
        propertyId: resolvedPropertyId,
        number: createRoomDto.number,
        tenantId,
      },
    });

    if (existingRoom) {
      throw new BadRequestException(
        `Room with number ${createRoomDto.number} already exists in this property`,
      );
    }

    const data: Prisma.RoomCreateInput = {
      number: createRoomDto.number,
      type: createRoomDto.type,
      price: new Prisma.Decimal(createRoomDto.price),
      property: { connect: { id: resolvedPropertyId } },
      tenantId,
      ...(createRoomDto.floor !== undefined && { floor: createRoomDto.floor }),
      ...(createRoomDto.status !== undefined && { status: createRoomDto.status }),
      ...(createRoomDto.maxOccupancy !== undefined && { maxOccupancy: createRoomDto.maxOccupancy }),
      ...(createRoomDto.bedType !== undefined && { bedType: createRoomDto.bedType }),
      ...(createRoomDto.size !== undefined && { size: createRoomDto.size }),
      ...(createRoomDto.amenities !== undefined && { amenities: createRoomDto.amenities }),
      ...(createRoomDto.extraBedAllowed !== undefined && { extraBedAllowed: createRoomDto.extraBedAllowed }),
      ...(createRoomDto.extraBedLimit !== undefined && { extraBedLimit: createRoomDto.extraBedLimit }),
      ...(createRoomDto.extraBedPrice !== undefined && { extraBedPrice: new Prisma.Decimal(createRoomDto.extraBedPrice) }),
      ...(createRoomDto.description !== undefined && { description: createRoomDto.description }),
      ...(createRoomDto.images !== undefined && { images: createRoomDto.images }),
      // Dynamic Pricing
      ...(createRoomDto.weekendPrice !== undefined && { weekendPrice: createRoomDto.weekendPrice }),
      ...(createRoomDto.holidayPriceEnabled !== undefined && { holidayPriceEnabled: createRoomDto.holidayPriceEnabled }),
      ...(createRoomDto.holidayPriceType !== undefined && { holidayPriceType: createRoomDto.holidayPriceType }),
      ...(createRoomDto.holidayPrice !== undefined && { holidayPrice: createRoomDto.holidayPrice }),
      ...(createRoomDto.holidayPricePercent !== undefined && { holidayPricePercent: createRoomDto.holidayPricePercent }),
      ...(createRoomDto.seasonalRates !== undefined && { seasonalRates: createRoomDto.seasonalRates as unknown as Prisma.InputJsonValue }),
    };
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
          tenantId,
        },
      });
      if (existingRoom) {
        throw new BadRequestException(
          `Room with number ${updateRoomDto.number} already exists in this property`,
        );
      }
    }

    const updateData: Prisma.RoomUpdateInput = {
      ...(updateRoomDto.number !== undefined && { number: updateRoomDto.number }),
      ...(updateRoomDto.type !== undefined && { type: updateRoomDto.type }),
      ...(updateRoomDto.price !== undefined && { price: new Prisma.Decimal(updateRoomDto.price) }),
      ...(updateRoomDto.floor !== undefined && { floor: updateRoomDto.floor }),
      ...(updateRoomDto.status !== undefined && { status: updateRoomDto.status }),
      ...(updateRoomDto.maxOccupancy !== undefined && { maxOccupancy: updateRoomDto.maxOccupancy }),
      ...(updateRoomDto.bedType !== undefined && { bedType: updateRoomDto.bedType }),
      ...(updateRoomDto.size !== undefined && { size: updateRoomDto.size }),
      ...(updateRoomDto.amenities !== undefined && { amenities: updateRoomDto.amenities }),
      ...(updateRoomDto.extraBedAllowed !== undefined && { extraBedAllowed: updateRoomDto.extraBedAllowed }),
      ...(updateRoomDto.extraBedLimit !== undefined && { extraBedLimit: updateRoomDto.extraBedLimit }),
      ...(updateRoomDto.extraBedPrice !== undefined && { extraBedPrice: new Prisma.Decimal(updateRoomDto.extraBedPrice) }),
      ...(updateRoomDto.description !== undefined && { description: updateRoomDto.description }),
      ...(updateRoomDto.images !== undefined && { images: updateRoomDto.images }),
      // Dynamic Pricing
      ...(updateRoomDto.weekendPrice !== undefined && { weekendPrice: updateRoomDto.weekendPrice }),
      ...(updateRoomDto.holidayPriceEnabled !== undefined && { holidayPriceEnabled: updateRoomDto.holidayPriceEnabled }),
      ...(updateRoomDto.holidayPriceType !== undefined && { holidayPriceType: updateRoomDto.holidayPriceType }),
      ...(updateRoomDto.holidayPrice !== undefined && { holidayPrice: updateRoomDto.holidayPrice }),
      ...(updateRoomDto.holidayPricePercent !== undefined && { holidayPricePercent: updateRoomDto.holidayPricePercent }),
      ...(updateRoomDto.seasonalRates !== undefined && { seasonalRates: updateRoomDto.seasonalRates as unknown as Prisma.InputJsonValue }),
    };
    return this.prisma.room.update({
      where: { id },
      data: updateData,
      include: { property: true },
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    const activeBookings = await this.prisma.booking.findFirst({
      where: {
        roomId: id,
        status: { in: ['confirmed', 'checked-in'] },
        tenantId,
      },
    });

    if (activeBookings) {
      throw new BadRequestException('Cannot delete room with active bookings');
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

  async getAvailableRooms(
    checkIn: string,
    checkOut: string,
    propertyId?: string,
    tenantId?: string,
  ) {
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
        OR: [{ checkIn: { lte: checkOutDate }, checkOut: { gte: checkInDate } }],
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
