import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface TodayActionsResponse {
  checkInsDue: number;
  checkOutsDue: number;
  roomsToClean: number;
  pendingPayments: number;
  checkIns: Array<{
    id: string;
    guestName: string;
    roomNumber: string;
    checkIn: Date;
    status: string;
  }>;
  checkOuts: Array<{
    id: string;
    guestName: string;
    roomNumber: string;
    checkOut: Date;
    status: string;
  }>;
}

interface MetricsResponse {
  occupancyRate: number;
  occupancyTrend: number;
  adr: number;
  adrTrend: number;
  revpar: number;
  todayRevenue: number;
  revenueTrend: number;
  totalRooms: number;
  occupiedRooms: number;
  availableRooms: number;
  arrivalsToday: number;
  departuresToday: number;
  inHouseGuests: number;
}

interface TimelineEvent {
  id: string;
  type: 'check-in' | 'check-out';
  time: Date;
  guestName: string;
  roomNumber: string;
  bookingId: string;
  status: string;
}

interface TimelineResponse {
  events: TimelineEvent[];
}

interface RoomHeatmapResponse {
  floors: Array<{
    floor: number;
    rooms: Array<{
      id: string;
      number: string;
      type: string;
      status: string;
      guestName?: string;
    }>;
  }>;
  summary: {
    vacantClean: number;
    vacantDirty: number;
    occupied: number;
    outOfOrder: number;
    total: number;
  };
}

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface ActivityFeedResponse {
  activities: ActivityItem[];
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  async getTodayActions(tenantId?: string, propertyId?: string): Promise<TodayActionsResponse> {
    if (!tenantId) {
      return {
        checkInsDue: 0,
        checkOutsDue: 0,
        roomsToClean: 0,
        pendingPayments: 0,
        checkIns: [],
        checkOuts: [],
      };
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const whereBase: Record<string, unknown> = { tenantId };
      if (propertyId) whereBase.propertyId = propertyId;

      const todayCheckIns = await this.prisma.booking.findMany({
        where: {
          ...whereBase,
          checkIn: { gte: today, lt: tomorrow },
          status: { in: ['confirmed', 'pending'] },
        },
        include: { room: true, guest: true },
        orderBy: { checkIn: 'asc' },
      });

      const todayCheckOuts = await this.prisma.booking.findMany({
        where: {
          ...whereBase,
          checkOut: { gte: today, lt: tomorrow },
          status: 'checked-in',
        },
        include: { room: true, guest: true },
        orderBy: { checkOut: 'asc' },
      });

      let roomsToClean = 0;
      try {
        roomsToClean = await this.prisma.room.count({
          where: {
            ...whereBase,
            status: { in: ['dirty', 'occupied_dirty'] },
          },
        });
      } catch {
        roomsToClean = 0;
      }

      let pendingPayments = 0;
      try {
        pendingPayments = await this.prisma.payments.count({
          where: { tenant_id: tenantId, status: 'pending' },
        });
      } catch {
        pendingPayments = 0;
      }

      return {
        checkInsDue: todayCheckIns.length,
        checkOutsDue: todayCheckOuts.length,
        roomsToClean,
        pendingPayments,
        checkIns: todayCheckIns.map((b) => ({
          id: b.id,
          guestName: b.guest
            ? `${b.guest.firstName} ${b.guest.lastName}`
            : `${b.guestFirstName || ''} ${b.guestLastName || ''}`.trim(),
          roomNumber: b.room?.number || 'Unassigned',
          checkIn: b.checkIn,
          status: b.status,
        })),
        checkOuts: todayCheckOuts.map((b) => ({
          id: b.id,
          guestName: b.guest
            ? `${b.guest.firstName} ${b.guest.lastName}`
            : `${b.guestFirstName || ''} ${b.guestLastName || ''}`.trim(),
          roomNumber: b.room?.number || 'N/A',
          checkOut: b.checkOut,
          status: b.status,
        })),
      };
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching today actions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      if (error instanceof Error && 'code' in error) {
        const prismaError = error as { code?: string };
        if (prismaError.code === 'P2021' || prismaError.code === 'P2022') {
          return {
            checkInsDue: 0,
            checkOutsDue: 0,
            roomsToClean: 0,
            pendingPayments: 0,
            checkIns: [],
            checkOuts: [],
          };
        }
      }
      return {
        checkInsDue: 0,
        checkOutsDue: 0,
        roomsToClean: 0,
        pendingPayments: 0,
        checkIns: [],
        checkOuts: [],
      };
    }
  }

  async getMetrics(tenantId?: string, propertyId?: string): Promise<MetricsResponse> {
    if (!tenantId) {
      return {
        occupancyRate: 0,
        occupancyTrend: 0,
        adr: 0,
        adrTrend: 0,
        revpar: 0,
        todayRevenue: 0,
        revenueTrend: 0,
        totalRooms: 0,
        occupiedRooms: 0,
        availableRooms: 0,
        arrivalsToday: 0,
        departuresToday: 0,
        inHouseGuests: 0,
      };
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const whereBase: Record<string, unknown> = { tenantId };
      if (propertyId) whereBase.propertyId = propertyId;

      const totalRooms = await this.prisma.room.count({
        where: { ...whereBase, status: { not: 'out_of_order' } },
      });

      const occupiedBookings = await this.prisma.booking.count({
        where: {
          ...whereBase,
          status: 'checked-in',
          checkIn: { lte: tomorrow },
          checkOut: { gte: today },
        },
      });

      const occupancyRate = totalRooms > 0 ? Math.round((occupiedBookings / totalRooms) * 100) : 0;

      const yesterdayOccupied = await this.prisma.booking.count({
        where: {
          ...whereBase,
          status: { in: ['checked-in', 'checked-out'] },
          checkIn: { lte: yesterday },
          checkOut: { gte: yesterday },
        },
      });
      const yesterdayOccupancy =
        totalRooms > 0 ? Math.round((yesterdayOccupied / totalRooms) * 100) : 0;
      const occupancyTrend = occupancyRate - yesterdayOccupancy;

      const todayBookings = await this.prisma.booking.findMany({
        where: {
          ...whereBase,
          status: { in: ['confirmed', 'checked-in', 'checked-out'] },
          checkIn: { gte: today, lt: tomorrow },
        },
        select: { totalPrice: true },
      });
      const todayRevenue = todayBookings.reduce(
        (sum, b) => sum + (b.totalPrice ? Number(b.totalPrice) : 0),
        0,
      );

      const yesterdayBookings = await this.prisma.booking.findMany({
        where: {
          ...whereBase,
          status: { in: ['confirmed', 'checked-in', 'checked-out'] },
          checkIn: { gte: yesterday, lt: today },
        },
        select: { totalPrice: true },
      });
      const yesterdayRevenue = yesterdayBookings.reduce(
        (sum, b) => sum + (b.totalPrice ? Number(b.totalPrice) : 0),
        0,
      );
      const revenueTrend =
        yesterdayRevenue > 0
          ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
          : 0;

      const adr = occupiedBookings > 0 ? Math.round(todayRevenue / occupiedBookings) : 0;
      const yesterdayAdr =
        yesterdayOccupied > 0 ? Math.round(yesterdayRevenue / yesterdayOccupied) : 0;
      const adrTrend =
        yesterdayAdr > 0 ? Math.round(((adr - yesterdayAdr) / yesterdayAdr) * 100) : 0;

      const revpar = totalRooms > 0 ? Math.round(todayRevenue / totalRooms) : 0;

      const arrivalsToday = await this.prisma.booking.count({
        where: {
          ...whereBase,
          checkIn: { gte: today, lt: tomorrow },
          status: { in: ['confirmed', 'pending'] },
        },
      });

      const departuresToday = await this.prisma.booking.count({
        where: {
          ...whereBase,
          checkOut: { gte: today, lt: tomorrow },
          status: 'checked-in',
        },
      });

      const guestsSum = await this.prisma.booking.aggregate({
        where: {
          ...whereBase,
          status: 'checked-in',
          checkIn: { lte: tomorrow },
          checkOut: { gte: today },
        },
        _sum: {
          numberOfGuests: true,
        },
      });
      const inHouseGuests = guestsSum._sum.numberOfGuests || 0;
      const availableRooms = totalRooms - occupiedBookings;

      return {
        occupancyRate,
        occupancyTrend,
        adr,
        adrTrend,
        revpar,
        todayRevenue,
        revenueTrend,
        totalRooms,
        occupiedRooms: occupiedBookings,
        availableRooms,
        arrivalsToday,
        departuresToday,
        inHouseGuests,
      };
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        occupancyRate: 0,
        occupancyTrend: 0,
        adr: 0,
        adrTrend: 0,
        revpar: 0,
        todayRevenue: 0,
        revenueTrend: 0,
        totalRooms: 0,
        occupiedRooms: 0,
        availableRooms: 0,
        arrivalsToday: 0,
        departuresToday: 0,
        inHouseGuests: 0,
      };
    }
  }

  async getTimeline(tenantId?: string, propertyId?: string): Promise<TimelineResponse> {
    if (!tenantId) return { events: [] };

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const whereBase: Record<string, unknown> = { tenantId };
      if (propertyId) whereBase.propertyId = propertyId;

      const [arrivals, departures] = await Promise.all([
        this.prisma.booking.findMany({
          where: {
            ...whereBase,
            checkIn: { gte: today, lt: tomorrow },
            status: { in: ['confirmed', 'pending', 'checked-in'] },
          },
          include: { room: true, guest: true },
        }),
        this.prisma.booking.findMany({
          where: {
            ...whereBase,
            checkOut: { gte: today, lt: tomorrow },
            status: { in: ['checked-in', 'checked-out'] },
          },
          include: { room: true, guest: true },
        }),
      ]);

      const events: TimelineEvent[] = [
        ...arrivals.map((b) => ({
          id: `checkin-${b.id}`,
          type: 'check-in' as const,
          time: b.checkIn,
          guestName: b.guest
            ? `${b.guest.firstName} ${b.guest.lastName}`
            : `${b.guestFirstName || ''} ${b.guestLastName || ''}`.trim(),
          roomNumber: b.room?.number || 'Unassigned',
          bookingId: b.id,
          status: b.status,
        })),
        ...departures.map((b) => ({
          id: `checkout-${b.id}`,
          type: 'check-out' as const,
          time: b.checkOut,
          guestName: b.guest
            ? `${b.guest.firstName} ${b.guest.lastName}`
            : `${b.guestFirstName || ''} ${b.guestLastName || ''}`.trim(),
          roomNumber: b.room?.number || 'N/A',
          bookingId: b.id,
          status: b.status,
        })),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      return { events };
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching timeline: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { events: [] };
    }
  }

  async getRoomHeatmap(tenantId?: string, propertyId?: string): Promise<RoomHeatmapResponse> {
    if (!tenantId) {
      return {
        floors: [],
        summary: { vacantClean: 0, vacantDirty: 0, occupied: 0, outOfOrder: 0, total: 0 },
      };
    }

    try {
      const whereBase: Record<string, unknown> = { tenantId };
      if (propertyId) whereBase.propertyId = propertyId;

      const rooms = await this.prisma.room.findMany({
        where: whereBase,
        include: {
          bookings: {
            where: { status: 'checked-in' },
            include: { guest: true },
            take: 1,
          },
        },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
      });

      const floorMap = new Map<number, typeof rooms>();
      for (const room of rooms) {
        const floor = room.floor || 1;
        if (!floorMap.has(floor)) floorMap.set(floor, []);
        floorMap.get(floor)!.push(room);
      }

      const floors = Array.from(floorMap.entries()).map(([floor, floorRooms]) => ({
        floor,
        rooms: floorRooms.map((r) => ({
          id: r.id,
          number: r.number,
          type: r.type || 'standard',
          status: r.status,
          guestName: r.bookings?.[0]?.guest
            ? `${r.bookings[0].guest.firstName} ${r.bookings[0].guest.lastName}`
            : undefined,
        })),
      }));

      const summary = {
        vacantClean: rooms.filter((r) => r.status === 'available').length,
        vacantDirty: rooms.filter((r) => r.status === 'dirty').length,
        occupied: rooms.filter((r) => r.status === 'occupied' || (r.bookings?.length ?? 0) > 0)
          .length,
        outOfOrder: rooms.filter((r) => r.status === 'out_of_order').length,
        total: rooms.length,
      };

      return { floors, summary };
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching room heatmap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        floors: [],
        summary: { vacantClean: 0, vacantDirty: 0, occupied: 0, outOfOrder: 0, total: 0 },
      };
    }
  }

  async getActivityFeed(
    tenantId?: string,
    propertyId?: string,
    limit = 20,
  ): Promise<ActivityFeedResponse> {
    if (!tenantId) return { activities: [] };

    try {
      const [auditLogs, notifications] = await Promise.all([
        this.prisma.auditLog
          .findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          .catch(() => []),
        this.prisma.notification
          .findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
          .catch(() => []),
      ]);

      const activities: ActivityItem[] = [
        ...auditLogs.map((log) => ({
          id: `audit-${log.id}`,
          type: 'audit',
          message: log.description || `${log.action} on ${log.resource}`,
          timestamp: log.createdAt,
          metadata: { action: log.action, resource: log.resource, resourceId: log.resourceId },
        })),
        ...notifications.map((n) => ({
          id: `notif-${n.id}`,
          type: n.type || 'info',
          message: n.message,
          timestamp: n.createdAt,
          metadata: { title: n.title, category: n.category },
        })),
      ]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      return { activities };
    } catch (error: unknown) {
      this.logger.error(
        `Error fetching activity feed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return { activities: [] };
    }
  }
}
