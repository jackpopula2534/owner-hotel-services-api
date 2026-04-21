import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  DemandForecastItemDto,
  DemandForecastResponseDto,
  OccupancyForecastResponseDto,
  RoomTypeOccupancyDto,
} from './dto';

interface ForecastItem {
  itemId: string;
  itemName: string;
  sku: string;
  totalRequired: number;
  currentStock: number;
  deficit: number;
  unit: string;
  roomType?: string;
  bookingCount?: number;
}

interface RoomTypeCount {
  [key: string]: {
    totalRooms: number;
    bookedRooms: number;
    count: number;
  };
}

@Injectable()
export class DemandForecastService {
  private readonly logger = new Logger(DemandForecastService.name);

  constructor(private readonly prisma: PrismaService) {}

  async forecastByDateRange(
    tenantId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
  ): Promise<DemandForecastResponseDto> {
    this.logger.debug(
      `Forecasting inventory for property ${propertyId} from ${startDate} to ${endDate}`,
    );

    // Validate date range
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Get all bookings in the date range, include room to access room.type
    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId,
        propertyId,
        scheduledCheckIn: {
          gte: start,
          lt: new Date(end.getTime() + 24 * 60 * 60 * 1000), // Include end date
        },
        status: {
          in: ['CONFIRMED', 'CHECKED_IN'],
        },
      },
      include: {
        room: true,
      },
    });

    // Collect distinct room types from the bookings
    const roomTypesInBookings = [...new Set(bookings.map((b) => b.room.type))];

    // Fetch amenity templates for all relevant room types in one query
    const amenityTemplates = await this.prisma.roomTypeAmenityTemplate.findMany({
      where: {
        tenantId,
        roomType: { in: roomTypesInBookings },
        taskType: 'checkout',
        isActive: true,
      },
      include: {
        item: true,
      },
    });

    // Build a lookup: roomType -> templates
    const templatesByRoomType = new Map<string, typeof amenityTemplates>();
    for (const template of amenityTemplates) {
      const existing = templatesByRoomType.get(template.roomType) ?? [];
      existing.push(template);
      templatesByRoomType.set(template.roomType, existing);
    }

    // Aggregate demand by item
    const demandMap = new Map<
      string,
      {
        itemId: string;
        itemName: string;
        sku: string;
        totalRequired: number;
        unit: string;
        roomType: string;
        bookingCount: number;
      }
    >();

    for (const booking of bookings) {
      const roomType = booking.room.type;
      const templates = templatesByRoomType.get(roomType);

      if (!templates || templates.length === 0) {
        continue;
      }

      for (const template of templates) {
        const itemId = template.item.id;
        const key = itemId;

        if (demandMap.has(key)) {
          const existing = demandMap.get(key)!;
          existing.totalRequired += template.quantity;
          existing.bookingCount += 1;
        } else {
          demandMap.set(key, {
            itemId,
            itemName: template.item.name,
            sku: template.item.sku,
            totalRequired: template.quantity,
            unit: String(template.item.unit),
            roomType,
            bookingCount: 1,
          });
        }
      }
    }

    // Get current stock levels for each item
    const items: ForecastItem[] = [];

    for (const demand of demandMap.values()) {
      // Get warehouse stock for this property
      const stocks = await this.prisma.warehouseStock.aggregate({
        where: {
          warehouse: {
            propertyId,
            tenantId,
          },
          itemId: demand.itemId,
        },
        _sum: {
          quantity: true,
        },
      });

      const currentStock = stocks._sum.quantity || 0;
      const deficit = Math.max(0, demand.totalRequired - currentStock);

      items.push({
        itemId: demand.itemId,
        itemName: demand.itemName,
        sku: demand.sku,
        totalRequired: demand.totalRequired,
        currentStock,
        deficit,
        unit: demand.unit,
        roomType: demand.roomType,
        bookingCount: demand.bookingCount,
      });
    }

    // Sort by deficit (highest first)
    items.sort((a, b) => b.deficit - a.deficit);

    const itemsWithDeficit = items.filter((item) => item.deficit > 0).length;

    return {
      propertyId,
      startDate,
      endDate,
      totalBookings: bookings.length,
      items: items.map((item) => ({
        itemId: item.itemId,
        itemName: item.itemName,
        sku: item.sku,
        totalRequired: item.totalRequired,
        currentStock: item.currentStock,
        deficit: item.deficit,
        unit: item.unit,
        roomType: item.roomType,
        bookingCount: item.bookingCount,
      })),
      itemsWithDeficit,
      generatedAt: new Date().toISOString(),
    };
  }

  async forecastWeekly(tenantId: string, propertyId: string): Promise<DemandForecastResponseDto> {
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];

    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return this.forecastByDateRange(tenantId, propertyId, startDate, endDate);
  }

  async forecastMonthly(tenantId: string, propertyId: string): Promise<DemandForecastResponseDto> {
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];

    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return this.forecastByDateRange(tenantId, propertyId, startDate, endDate);
  }

  async getOccupancyForecast(
    tenantId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
  ): Promise<OccupancyForecastResponseDto> {
    this.logger.debug(
      `Getting occupancy forecast for property ${propertyId} from ${startDate} to ${endDate}`,
    );

    // Validate date range
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      throw new BadRequestException('Start date must be before end date');
    }

    // Get all rooms in the property to find distinct types and total counts
    const rooms = await this.prisma.room.findMany({
      where: {
        propertyId,
        tenantId,
      },
      select: {
        id: true,
        type: true,
      },
    });

    // Build room type -> room count map and get distinct types
    const roomTypeCountMap = new Map<string, number>(); // type -> total room count
    for (const room of rooms) {
      roomTypeCountMap.set(room.type, (roomTypeCountMap.get(room.type) ?? 0) + 1);
    }

    const distinctRoomTypes = [...roomTypeCountMap.keys()];
    const totalRooms = rooms.length;

    const roomTypeCounts: RoomTypeCount = {};

    // Initialize room type counts
    for (const roomType of distinctRoomTypes) {
      const totalCount = roomTypeCountMap.get(roomType) ?? 0;

      roomTypeCounts[roomType] = {
        totalRooms: totalCount,
        bookedRooms: 0,
        count: 0,
      };
    }

    // Get bookings in date range, include room to access room.type
    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId,
        propertyId,
        scheduledCheckIn: {
          gte: start,
          lt: new Date(end.getTime() + 24 * 60 * 60 * 1000), // Include end date
        },
        status: {
          in: ['CONFIRMED', 'CHECKED_IN'],
        },
      },
      include: {
        room: true,
      },
    });

    // Count bookings by room type
    const bookedRoomsSet = new Set<string>();
    let totalBookingCount = 0;

    for (const booking of bookings) {
      const roomType = booking.room.type;
      bookedRoomsSet.add(booking.room.id);
      totalBookingCount += 1;

      const count = roomTypeCounts[roomType];
      if (count) {
        count.count += 1;
      }
    }

    // Count unique booked rooms
    const totalBookedRooms = bookedRoomsSet.size;

    // Calculate occupancy by room type
    const byRoomType: RoomTypeOccupancyDto[] = [];

    for (const roomType of distinctRoomTypes) {
      const count = roomTypeCounts[roomType];
      const occupancyPercentage =
        count.totalRooms > 0 ? Math.round((count.count / count.totalRooms) * 100) : 0;

      byRoomType.push({
        roomType,
        totalRooms: count.totalRooms,
        bookedRooms: count.count,
        occupancyPercentage,
      });
    }

    const overallOccupancy = totalRooms > 0 ? Math.round((totalBookedRooms / totalRooms) * 100) : 0;

    return {
      propertyId,
      startDate,
      endDate,
      totalRooms,
      bookedRooms: totalBookedRooms,
      occupancyPercentage: overallOccupancy,
      totalBookings: totalBookingCount,
      byRoomType,
      generatedAt: new Date().toISOString(),
    };
  }
}
