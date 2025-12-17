import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BookingsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any) {
    const { page = 1, limit = 10, status, guestId, roomId } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (guestId) where.guestId = guestId;
    if (roomId) where.roomId = roomId;

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        skip,
        take: parseInt(limit),
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
      page: parseInt(page),
      limit: parseInt(limit),
    };
  }

  async findOne(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
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

  async create(createBookingDto: any) {
    const { guestId, roomId, checkIn, checkOut } = createBookingDto;

    // Validate dates
    if (new Date(checkOut) <= new Date(checkIn)) {
      throw new BadRequestException('Check-out date must be after check-in date');
    }

    // Check room availability
    const existingBooking = await this.prisma.booking.findFirst({
      where: {
        roomId,
        status: { in: ['confirmed', 'checked-in'] },
        OR: [
          {
            checkIn: { lte: new Date(checkOut) },
            checkOut: { gte: new Date(checkIn) },
          },
        ],
      },
    });

    if (existingBooking) {
      throw new BadRequestException('Room is not available for the selected dates');
    }

    // Get room price
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    // Calculate total price
    const nights = Math.ceil(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24),
    );
    const totalPrice = Number(room.price) * nights;

    return this.prisma.booking.create({
      data: {
        ...createBookingDto,
        totalPrice,
      },
      include: {
        guest: true,
        room: true,
      },
    });
  }

  async update(id: string, updateBookingDto: any) {
    await this.findOne(id); // Check if exists

    return this.prisma.booking.update({
      where: { id },
      data: updateBookingDto,
      include: {
        guest: true,
        room: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if exists

    return this.prisma.booking.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}

