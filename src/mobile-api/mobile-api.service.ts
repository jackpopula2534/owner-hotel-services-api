import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import {
  MobileDashboardDto,
  MobileBookingSummaryDto,
  MobileRoomSummaryDto,
  MobileGuestSummaryDto,
  MobileAppConfigDto,
  MobilePaginationDto,
} from './dto/mobile.dto';

@Injectable()
export class MobileApiService {
  private readonly logger = new Logger(MobileApiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Get mobile dashboard data (lightweight)
   */
  async getDashboard(tenantId: string): Promise<MobileDashboardDto> {
    const cacheKey = `mobile:dashboard:${tenantId}`;

    // Try cache first
    const cached = await this.cacheService.get<MobileDashboardDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      todayCheckIns,
      todayCheckOuts,
      totalRooms,
      occupiedRooms,
      pendingBookings,
      recentBookings,
      todayRevenue,
    ] = await Promise.all([
      // Today's check-ins
      this.prisma.booking.count({
        where: {
          tenantId,
          checkIn: { gte: today, lt: tomorrow },
          status: { in: ['confirmed', 'checked_in'] },
        },
      }),
      // Today's check-outs
      this.prisma.booking.count({
        where: {
          tenantId,
          checkOut: { gte: today, lt: tomorrow },
          status: { in: ['checked_in', 'checked_out'] },
        },
      }),
      // Total rooms
      this.prisma.room.count({
        where: { tenantId },
      }),
      // Occupied rooms
      this.prisma.room.count({
        where: { tenantId, status: 'occupied' },
      }),
      // Pending bookings
      this.prisma.booking.count({
        where: { tenantId, status: 'pending' },
      }),
      // Recent bookings (last 5)
      this.prisma.booking.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          room: { select: { number: true } },
        },
      }),
      // Today's revenue (from payments)
      this.prisma.payments.aggregate({
        where: {
          created_at: { gte: today, lt: tomorrow },
          status: 'approved',
        },
        _sum: { amount: true },
      }),
    ]);

    const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
    const availableRooms = totalRooms - occupiedRooms;

    const dashboard: MobileDashboardDto = {
      todayCheckIns,
      todayCheckOuts,
      occupancyRate: Math.round(occupancyRate * 10) / 10,
      totalRevenue: Number(todayRevenue._sum.amount || 0),
      pendingBookings,
      availableRooms,
      recentBookings: recentBookings.map((b) => ({
        id: b.id,
        bookingNumber: b.id.substring(0, 8).toUpperCase(),
        guestName: `${b.guestFirstName} ${b.guestLastName}`,
        roomNumber: b.room?.number || 'N/A',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        totalPrice: Number(b.totalPrice),
      })),
    };

    // Cache for 1 minute
    await this.cacheService.set(cacheKey, dashboard, { ttl: 60 });

    return dashboard;
  }

  /**
   * Get bookings list (lightweight)
   */
  async getBookings(
    tenantId: string,
    pagination: MobilePaginationDto,
    status?: string,
  ): Promise<{ data: MobileBookingSummaryDto[]; total: number; hasMore: boolean }> {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          room: { select: { number: true } },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      data: bookings.map((b) => ({
        id: b.id,
        bookingNumber: b.id.substring(0, 8).toUpperCase(),
        guestName: `${b.guestFirstName} ${b.guestLastName}`,
        roomNumber: b.room?.number || 'N/A',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        totalPrice: Number(b.totalPrice),
      })),
      total,
      hasMore: skip + bookings.length < total,
    };
  }

  /**
   * Get rooms list (lightweight)
   */
  async getRooms(
    tenantId: string,
    pagination: MobilePaginationDto,
    status?: string,
  ): Promise<{ data: MobileRoomSummaryDto[]; total: number; hasMore: boolean }> {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (status) {
      where.status = status;
    }

    const [rooms, total] = await Promise.all([
      this.prisma.room.findMany({
        where,
        orderBy: { number: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.room.count({ where }),
    ]);

    return {
      data: rooms.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        price: Number(r.price),
        floor: r.floor || undefined,
      })),
      total,
      hasMore: skip + rooms.length < total,
    };
  }

  /**
   * Get guests list (lightweight)
   */
  async getGuests(
    tenantId: string,
    pagination: MobilePaginationDto,
    search?: string,
  ): Promise<{ data: MobileGuestSummaryDto[]; total: number; hasMore: boolean }> {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [guests, total] = await Promise.all([
      this.prisma.guest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { bookings: true } },
        },
      }),
      this.prisma.guest.count({ where }),
    ]);

    return {
      data: guests.map((g) => ({
        id: g.id,
        fullName: `${g.firstName} ${g.lastName}`,
        phone: g.phone || undefined,
        email: g.email || undefined,
        isVip: g.isVip,
        totalStays: g._count.bookings,
      })),
      total,
      hasMore: skip + guests.length < total,
    };
  }

  /**
   * Quick room status update
   */
  async updateRoomStatus(
    tenantId: string,
    roomId: string,
    status: string,
  ): Promise<MobileRoomSummaryDto> {
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: { status },
    });

    // Invalidate dashboard cache
    await this.cacheService.del(`mobile:dashboard:${tenantId}`);

    return {
      id: room.id,
      number: room.number,
      type: room.type,
      status: room.status,
      price: Number(room.price),
      floor: room.floor || undefined,
    };
  }

  /**
   * Quick booking status update
   */
  async updateBookingStatus(
    tenantId: string,
    bookingId: string,
    status: string,
  ): Promise<MobileBookingSummaryDto> {
    const booking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status },
      include: {
        room: { select: { number: true } },
      },
    });

    // Invalidate dashboard cache
    await this.cacheService.del(`mobile:dashboard:${tenantId}`);

    return {
      id: booking.id,
      bookingNumber: booking.id.substring(0, 8).toUpperCase(),
      guestName: `${booking.guestFirstName} ${booking.guestLastName}`,
      roomNumber: booking.room?.number || 'N/A',
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: booking.status,
      totalPrice: Number(booking.totalPrice),
    };
  }

  /**
   * Get app configuration
   */
  getAppConfig(): MobileAppConfigDto {
    return {
      minVersion: '1.0.0',
      latestVersion: '1.2.0',
      forceUpdate: false,
      maintenanceMode: false,
      maintenanceMessage: undefined,
      features: {
        bookingEnabled: true,
        paymentEnabled: true,
        pushNotifications: true,
      },
    };
  }

  /**
   * Search across entities (quick search)
   */
  async quickSearch(
    tenantId: string,
    query: string,
  ): Promise<{
    bookings: MobileBookingSummaryDto[];
    guests: MobileGuestSummaryDto[];
    rooms: MobileRoomSummaryDto[];
  }> {
    const [bookings, guests, rooms] = await Promise.all([
      // Search bookings
      this.prisma.booking.findMany({
        where: {
          tenantId,
          OR: [
            { guestFirstName: { contains: query } },
            { guestLastName: { contains: query } },
            { guestEmail: { contains: query } },
          ],
        },
        take: 5,
        include: {
          room: { select: { number: true } },
        },
      }),
      // Search guests
      this.prisma.guest.findMany({
        where: {
          tenantId,
          OR: [
            { firstName: { contains: query } },
            { lastName: { contains: query } },
            { email: { contains: query } },
            { phone: { contains: query } },
          ],
        },
        take: 5,
        include: {
          _count: { select: { bookings: true } },
        },
      }),
      // Search rooms
      this.prisma.room.findMany({
        where: {
          tenantId,
          OR: [
            { number: { contains: query } },
            { type: { contains: query } },
          ],
        },
        take: 5,
      }),
    ]);

    return {
      bookings: bookings.map((b) => ({
        id: b.id,
        bookingNumber: b.id.substring(0, 8).toUpperCase(),
        guestName: `${b.guestFirstName} ${b.guestLastName}`,
        roomNumber: b.room?.number || 'N/A',
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        status: b.status,
        totalPrice: Number(b.totalPrice),
      })),
      guests: guests.map((g) => ({
        id: g.id,
        fullName: `${g.firstName} ${g.lastName}`,
        phone: g.phone || undefined,
        email: g.email || undefined,
        isVip: g.isVip,
        totalStays: g._count.bookings,
      })),
      rooms: rooms.map((r) => ({
        id: r.id,
        number: r.number,
        type: r.type,
        status: r.status,
        price: Number(r.price),
        floor: r.floor || undefined,
      })),
    };
  }
}
