import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, guestId, roomId, propertyId, search } = query;
    const skip = (page - 1) * limit;

    // ถ้าไม่มี tenantId (user ใหม่ยังไม่มีโรงแรม) ให้ return empty data
    if (!tenantId) {
      return {
        data: [],
        total: 0,
        page,
        limit,
      };
    }

    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
    if (status) where.status = status;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;
    if (propertyId) where.propertyId = propertyId;

    if (search) {
      where.OR = [
        { guestFirstName: { contains: search } },
        { guestLastName: { contains: search } },
        { guestEmail: { contains: search } },
        { room: { number: { contains: search } } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.booking.findMany({
          where,
          skip,
          take: limit,
          include: {
            guest: true,
            room: true,
            property: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.booking.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
      };
    } catch (error) {
      // ถ้าเกิด database error (table/column ไม่มี) ให้ส่ง empty data สำหรับผู้ใช้ใหม่
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
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const booking = await this.prisma.booking.findFirst({
      where,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }

    return booking;
  }

  async create(createBookingDto: any, tenantId?: string) {
    const { propertyId, roomId, guestId, checkIn, checkOut } = createBookingDto;

    // Validate dates
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    // Verify property belongs to tenant
    const propertyWhere: any = { id: propertyId };
    if (tenantId != null) propertyWhere.tenantId = tenantId;
    const property = await this.prisma.property.findFirst({
      where: propertyWhere,
    });

    if (!property) {
      throw new NotFoundException('Property not found');
    }

    // Verify room belongs to property
    const roomWhere: any = { id: roomId, propertyId };
    if (tenantId != null) roomWhere.tenantId = tenantId;
    const room = await this.prisma.room.findFirst({
      where: roomWhere,
    });

    if (!room) {
      throw new NotFoundException('Room not found in this property');
    }

    // Check room availability
    const bookingScope: any = {
      roomId,
      status: { in: ['confirmed', 'checked-in'] },
      OR: [
        {
          checkIn: { lte: new Date(checkOut) },
          checkOut: { gte: new Date(checkIn) },
        },
      ],
    };
    if (tenantId != null) bookingScope.tenantId = tenantId;

    const existingBooking = await this.prisma.booking.findFirst({
      where: bookingScope,
    });

    if (existingBooking) {
      throw new BadRequestException('Room is not available for the selected dates');
    }

    // If guestId provided, verify it exists and optionally auto-fill guest data
    if (guestId) {
      const guestWhere: any = { id: guestId };
      if (tenantId != null) guestWhere.tenantId = tenantId;
      const guest = await this.prisma.guest.findFirst({
        where: guestWhere,
      });

      if (!guest) {
        throw new NotFoundException('Guest not found');
      }

      // Auto-populate guest data from Guest record if not provided
      if (!createBookingDto.guestFirstName) {
        createBookingDto.guestFirstName = guest.firstName;
      }
      if (!createBookingDto.guestLastName) {
        createBookingDto.guestLastName = guest.lastName;
      }
      if (!createBookingDto.guestEmail && guest.email) {
        createBookingDto.guestEmail = guest.email;
      }
      if (!createBookingDto.guestPhone && guest.phone) {
        createBookingDto.guestPhone = guest.phone;
      }
    }

    // Calculate total price
    const nights = Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24),
    );
    const totalPrice = Number(room.price) * nights;

    const data: any = {
      ...createBookingDto,
      totalPrice,
    };
    if (tenantId != null) data.tenantId = tenantId;

    return this.prisma.booking.create({
      data,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });
  }

  async update(id: string, updateBookingDto: any, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.booking.update({
      where: { id },
      data: updateBookingDto,
      include: {
        guest: true,
        room: true,
        property: true,
      },
    });
  }

  async remove(id: string, tenantId?: string) {
    await this.findOne(id, tenantId);

    return this.prisma.booking.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}

