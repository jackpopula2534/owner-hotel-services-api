import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any, tenantId?: string) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const { status, guestId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (tenantId != null) where.tenantId = tenantId;
    if (status) where.status = status;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: limit,
        include: {
          guest: true,
          room: true,
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
  }

  async findOne(id: string, tenantId?: string) {
    const where: any = { id };
    if (tenantId != null) where.tenantId = tenantId;

    const booking = await this.prisma.booking.findFirst({
      where,
      include: {
        guest: true,
        room: true,
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking with ID ${id} not found`);
    }

    return booking;
  }

  async create(createBookingDto: any, tenantId?: string) {
    const { guestId, roomId, checkIn, checkOut } = createBookingDto;

    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    const roomWhere: any = { id: roomId };
    if (tenantId != null) roomWhere.tenantId = tenantId;
    const room = await this.prisma.room.findFirst({
      where: roomWhere,
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

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

