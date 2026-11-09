import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_CLEANING_BUFFER_MINUTES,
} from '../../common/availability/availability.util';

interface AvailabilityResult {
  available: boolean;
  reason?: string;
  nextAvailableAt?: Date;
}

interface AvailableRoomsResult {
  rooms: any[];
  propertyTimeSettings: {
    standardCheckInTime: string;
    standardCheckOutTime: string;
    cleaningBufferMinutes: number;
  };
}

@Injectable()
export class RoomAvailabilityService {
  private readonly logger = new Logger(RoomAvailabilityService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check if a room is available for the requested date range
   * Takes into account cleaning buffer from property settings
   */
  async checkRoomAvailable(
    roomId: string,
    requestedCheckIn: Date,
    requestedCheckOut: Date,
    tenantId: string,
    excludeBookingId?: string,
  ): Promise<AvailabilityResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (requestedCheckIn >= requestedCheckOut) {
      throw new BadRequestException('Check-in date must be before check-out date');
    }

    try {
      // Get room with property
      const room = await this.prisma.room.findFirst({
        where: { id: roomId, tenantId },
        include: { property: true },
      });

      if (!room) {
        throw new NotFoundException(`Room with ID ${roomId} not found`);
      }

      // Get property settings for cleaning buffer
      const property = room.property;
      const cleaningBufferMinutes = property?.cleaningBufferMinutes ?? 60;

      // Get all bookings for this room that are not deleted
      const bookings = await this.prisma.booking.findMany({
        where: {
          roomId,
          status: { in: ['pending', 'confirmed', 'checked_in', 'checked_out'] },
          ...(excludeBookingId && { NOT: { id: excludeBookingId } }),
        },
        select: {
          id: true,
          scheduledCheckIn: true,
          scheduledCheckOut: true,
          actualCheckOut: true,
          status: true,
        },
      });

      // Build list of blocked time periods
      // ทุก booking active block ช่วงเวลาของตัวเอง + cleaning buffer ด้านท้าย
      // เพื่อให้แม่บ้านมีเวลาทำความสะอาดก่อนแขกคนถัดไปเช็คอิน
      const cleaningBufferMs = cleaningBufferMinutes * 60 * 1000;
      const blockedPeriods: Array<{ start: Date; end: Date; reason: string }> = [];

      for (const booking of bookings) {
        if (booking.status === 'checked_out' && booking.actualCheckOut) {
          // Room is blocked until: actualCheckOut + cleaningBufferMinutes
          const cleaningEndTime = new Date(
            new Date(booking.actualCheckOut).getTime() + cleaningBufferMs,
          );
          blockedPeriods.push({
            start: new Date(booking.actualCheckOut),
            end: cleaningEndTime,
            reason: `Cleaning buffer after booking ${booking.id}`,
          });
        } else {
          // For pending, confirmed, or checked_in: block scheduled period + cleaning buffer
          const blockedEnd = new Date(
            new Date(booking.scheduledCheckOut).getTime() + cleaningBufferMs,
          );
          blockedPeriods.push({
            start: new Date(booking.scheduledCheckIn),
            end: blockedEnd,
            reason: `Booking ${booking.id} (incl. cleaning buffer)`,
          });
        }
      }

      // Check if requested period overlaps with any blocked periods
      for (const blocked of blockedPeriods) {
        // Check if there's overlap: requestedCheckIn < blocked.end AND requestedCheckOut > blocked.start
        if (requestedCheckIn < blocked.end && requestedCheckOut > blocked.start) {
          return {
            available: false,
            reason: blocked.reason,
            nextAvailableAt: blocked.end,
          };
        }
      }

      return {
        available: true,
      };
    } catch (error) {
      if (error instanceof (NotFoundException || BadRequestException)) {
        throw error;
      }
      this.logger.error(`Failed to check room availability: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all available rooms for a property during a date range
   * Includes property time settings (checkIn/checkOut times, cleaning buffer)
   */
  async getAvailableRooms(
    propertyId: string,
    checkIn: Date,
    checkOut: Date,
    tenantId: string,
  ): Promise<AvailableRoomsResult> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (checkIn >= checkOut) {
      throw new BadRequestException('Check-in date must be before check-out date');
    }

    try {
      // Get property with settings
      const property = await this.prisma.property.findFirst({
        where: { id: propertyId, tenantId },
      });

      if (!property) {
        throw new NotFoundException(`Property with ID ${propertyId} not found`);
      }

      const standardCheckInTime = property.standardCheckInTime ?? DEFAULT_CHECK_IN_TIME;
      const standardCheckOutTime = property.standardCheckOutTime ?? DEFAULT_CHECK_OUT_TIME;
      const cleaningBufferMinutes =
        property.cleaningBufferMinutes ?? DEFAULT_CLEANING_BUFFER_MINUTES;

      // Get all rooms in the property
      const allRooms = await this.prisma.room.findMany({
        where: { propertyId, tenantId },
      });

      // Get all bookings that might block rooms
      const bookings = await this.prisma.booking.findMany({
        where: {
          room: { propertyId },
          status: { in: ['pending', 'confirmed', 'checked_in', 'checked_out'] },
        },
        select: {
          roomId: true,
          scheduledCheckIn: true,
          scheduledCheckOut: true,
          actualCheckOut: true,
          status: true,
        },
      });

      // For each room, check if available
      const availableRooms = [];

      for (const room of allRooms) {
        const isAvailable = await this.checkRoomAvailable(room.id, checkIn, checkOut, tenantId);

        if (isAvailable.available) {
          availableRooms.push(room);
        }
      }

      return {
        rooms: availableRooms,
        propertyTimeSettings: {
          standardCheckInTime,
          standardCheckOutTime,
          cleaningBufferMinutes,
        },
      };
    } catch (error) {
      if (error instanceof (NotFoundException || BadRequestException)) {
        throw error;
      }
      this.logger.error(`Failed to get available rooms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build a scheduled DateTime from a date-only string (YYYY-MM-DD)
   * Uses the appropriate time based on timeType (checkIn or checkOut).
   *
   * Returns a Date interpreted in Bangkok timezone (UTC+7) so the result
   * is identical regardless of the machine's local timezone (important
   * for CI/server reliability).
   */
  async buildScheduledDateTime(
    dateStr: string,
    timeType: 'checkIn' | 'checkOut',
    propertyId: string,
  ): Promise<Date> {
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    try {
      // Get property settings
      const property = await this.prisma.property.findFirst({
        where: { id: propertyId },
        select: {
          standardCheckInTime: true,
          standardCheckOutTime: true,
        },
      });

      if (!property) {
        throw new NotFoundException(`Property with ID ${propertyId} not found`);
      }

      const timeStr =
        timeType === 'checkIn'
          ? (property.standardCheckInTime ?? DEFAULT_CHECK_IN_TIME)
          : (property.standardCheckOutTime ?? DEFAULT_CHECK_OUT_TIME);

      // Delegate to the shared util — TZ-independent, returns Date in Bangkok TZ
      return buildBangkokDateTime(dateStr, timeStr);
    } catch (error) {
      if (error instanceof (NotFoundException || BadRequestException)) {
        throw error;
      }
      this.logger.error(`Failed to build scheduled datetime: ${error.message}`);
      throw error;
    }
  }
}
