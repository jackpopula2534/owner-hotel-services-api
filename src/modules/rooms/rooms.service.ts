import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { Prisma } from '@prisma/client';
import {
  applyCleaningBuffer,
  buildBangkokDateTime,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  DEFAULT_CLEANING_BUFFER_MINUTES,
  resolveTimeWithFallback,
  UNBOOKABLE_ROOM_STATUSES,
} from '../../common/availability/availability.util';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

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
                status: { in: ['pending', 'confirmed', 'checked_in'] },
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

  async create(createRoomDto: CreateRoomDto, tenantId?: string, userId?: string) {
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

    const childPricing = this.normalizeChildNoExtraChargeFields(createRoomDto);

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
      ...(createRoomDto.extraBedAllowed !== undefined && {
        extraBedAllowed: createRoomDto.extraBedAllowed,
      }),
      ...(createRoomDto.extraBedLimit !== undefined && {
        extraBedLimit: createRoomDto.extraBedLimit,
      }),
      ...(createRoomDto.extraBedPrice !== undefined && {
        extraBedPrice: new Prisma.Decimal(createRoomDto.extraBedPrice),
      }),
      ...(createRoomDto.description !== undefined && { description: createRoomDto.description }),
      ...(createRoomDto.images !== undefined && { images: createRoomDto.images }),
      // Dynamic Pricing
      ...(createRoomDto.weekendPrice !== undefined && { weekendPrice: createRoomDto.weekendPrice }),
      ...(createRoomDto.holidayPriceEnabled !== undefined && {
        holidayPriceEnabled: createRoomDto.holidayPriceEnabled,
      }),
      ...(createRoomDto.holidayPriceType !== undefined && {
        holidayPriceType: createRoomDto.holidayPriceType,
      }),
      ...(createRoomDto.holidayPrice !== undefined && { holidayPrice: createRoomDto.holidayPrice }),
      ...(createRoomDto.holidayPricePercent !== undefined && {
        holidayPricePercent: createRoomDto.holidayPricePercent,
      }),
      ...(createRoomDto.seasonalRates !== undefined && {
        seasonalRates: createRoomDto.seasonalRates as unknown as Prisma.InputJsonValue,
      }),
      ...(childPricing.childNoExtraCharge !== undefined && {
        childNoExtraCharge: childPricing.childNoExtraCharge,
      }),
      ...(childPricing.childNoExtraChargeNote !== undefined && {
        childNoExtraChargeNote: childPricing.childNoExtraChargeNote,
      }),
    };
    const result = await this.prisma.room.create({
      data,
      include: { property: true },
    });

    await this.auditLogService.logRoomCreate(result, userId, tenantId);

    return result;
  }

  async update(id: string, updateRoomDto: UpdateRoomDto, tenantId?: string, userId?: string) {
    const room = await this.findOne(id, tenantId);
    const oldRoom = { ...room };

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

    const childPricing = this.normalizeChildNoExtraChargeFields(updateRoomDto, {
      childNoExtraCharge: room.childNoExtraCharge,
      childNoExtraChargeNote: room.childNoExtraChargeNote,
    });

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
      ...(updateRoomDto.extraBedAllowed !== undefined && {
        extraBedAllowed: updateRoomDto.extraBedAllowed,
      }),
      ...(updateRoomDto.extraBedLimit !== undefined && {
        extraBedLimit: updateRoomDto.extraBedLimit,
      }),
      ...(updateRoomDto.extraBedPrice !== undefined && {
        extraBedPrice: new Prisma.Decimal(updateRoomDto.extraBedPrice),
      }),
      ...(updateRoomDto.description !== undefined && { description: updateRoomDto.description }),
      ...(updateRoomDto.images !== undefined && { images: updateRoomDto.images }),
      // Dynamic Pricing
      ...(updateRoomDto.weekendPrice !== undefined && { weekendPrice: updateRoomDto.weekendPrice }),
      ...(updateRoomDto.holidayPriceEnabled !== undefined && {
        holidayPriceEnabled: updateRoomDto.holidayPriceEnabled,
      }),
      ...(updateRoomDto.holidayPriceType !== undefined && {
        holidayPriceType: updateRoomDto.holidayPriceType,
      }),
      ...(updateRoomDto.holidayPrice !== undefined && { holidayPrice: updateRoomDto.holidayPrice }),
      ...(updateRoomDto.holidayPricePercent !== undefined && {
        holidayPricePercent: updateRoomDto.holidayPricePercent,
      }),
      ...(updateRoomDto.seasonalRates !== undefined && {
        seasonalRates: updateRoomDto.seasonalRates as unknown as Prisma.InputJsonValue,
      }),
      ...(childPricing.childNoExtraCharge !== undefined && {
        childNoExtraCharge: childPricing.childNoExtraCharge,
      }),
      ...(childPricing.childNoExtraChargeNote !== undefined && {
        childNoExtraChargeNote: childPricing.childNoExtraChargeNote,
      }),
    };
    const result = await this.prisma.room.update({
      where: { id },
      data: updateData,
      include: { property: true },
    });

    await this.auditLogService.logRoomUpdate(id, oldRoom, result, userId, tenantId);

    return result;
  }

  async remove(id: string, tenantId?: string, userId?: string) {
    const room = await this.findOne(id, tenantId);

    const activeBookings = await this.prisma.booking.findFirst({
      where: {
        roomId: id,
        status: { in: ['pending', 'confirmed', 'checked_in'] },
        tenantId,
      },
    });

    if (activeBookings) {
      throw new BadRequestException('Cannot delete room with active bookings');
    }

    const deletedRoom = await this.prisma.room.delete({
      where: { id },
    });

    await this.auditLogService.logRoomDelete(deletedRoom, userId, tenantId);

    return deletedRoom;
  }

  async updateStatus(id: string, status: string, tenantId?: string, userId?: string) {
    const room = await this.findOne(id, tenantId);
    const oldStatus = room.status;

    const result = await this.prisma.room.update({
      where: { id },
      data: { status },
    });

    await this.auditLogService.logRoomStatusChange(result, oldStatus, status, userId, tenantId);

    return result;
  }

  async getAvailableRooms(
    checkIn: string,
    checkOut: string,
    propertyId?: string,
    tenantId?: string,
    checkInTime?: string,
    checkOutTime?: string,
  ) {
    // ถ้าไม่มี tenantId (ผู้ใช้ใหม่) ให้ส่ง empty array กลับไป
    if (!tenantId) {
      return [];
    }

    try {
      // Step 1: resolve property time settings (fallback chain handled by util)
      let propertyCheckInTime: string | null = null;
      let propertyCheckOutTime: string | null = null;
      let cleaningBufferMinutes: number = DEFAULT_CLEANING_BUFFER_MINUTES;

      if (propertyId) {
        const property = await this.prisma.property.findFirst({
          where: { id: propertyId, tenantId },
          select: {
            standardCheckInTime: true,
            standardCheckOutTime: true,
            cleaningBufferMinutes: true,
          },
        });
        if (property) {
          propertyCheckInTime = property.standardCheckInTime;
          propertyCheckOutTime = property.standardCheckOutTime;
          cleaningBufferMinutes = property.cleaningBufferMinutes ?? DEFAULT_CLEANING_BUFFER_MINUTES;
        }
      }

      const effectiveCheckInTime = resolveTimeWithFallback(
        checkInTime,
        propertyCheckInTime,
        DEFAULT_CHECK_IN_TIME,
      );
      const effectiveCheckOutTime = resolveTimeWithFallback(
        checkOutTime,
        propertyCheckOutTime,
        DEFAULT_CHECK_OUT_TIME,
      );

      // Step 2: build Bangkok-local datetimes and expand by cleaning buffer
      const checkInDate = buildBangkokDateTime(checkIn, effectiveCheckInTime);
      const checkOutDate = buildBangkokDateTime(checkOut, effectiveCheckOutTime);
      const { overlapStart, overlapEnd } = applyCleaningBuffer(
        checkInDate,
        checkOutDate,
        cleaningBufferMinutes,
      );

      this.logger.debug(
        `Availability check: ${checkIn} ${effectiveCheckInTime} → ${checkOut} ${effectiveCheckOutTime} ` +
          `(buffer: ${cleaningBufferMinutes}min, UTC range: ${overlapStart.toISOString()} → ${overlapEnd.toISOString()})`,
      );

      // Step 3: find conflicting bookings via overlap query.
      // overlap (with buffer): existing.scheduledCheckIn < overlapEnd AND existing.scheduledCheckOut > overlapStart
      const bookingWhere: any = {
        tenantId,
        status: { in: ['pending', 'confirmed', 'checked_in'] },
        scheduledCheckIn: { lt: overlapEnd },
        scheduledCheckOut: { gt: overlapStart },
      };

      // fallback for legacy bookings that have no scheduledCheckIn/Out
      const bookingWhereFallback: any = {
        tenantId,
        status: { in: ['pending', 'confirmed', 'checked_in'] },
        scheduledCheckIn: null,
        checkIn: { lt: overlapEnd },
        checkOut: { gt: overlapStart },
      };

      if (propertyId) {
        bookingWhere.room = { propertyId };
        bookingWhereFallback.room = { propertyId };
      }

      const [conflictingBookings, conflictingFallback] = await Promise.all([
        this.prisma.booking.findMany({ where: bookingWhere, select: { roomId: true } }),
        this.prisma.booking.findMany({ where: bookingWhereFallback, select: { roomId: true } }),
      ]);

      const occupiedRoomIds = [
        ...new Set([
          ...conflictingBookings.map((b) => b.roomId),
          ...conflictingFallback.map((b) => b.roomId),
        ]),
      ];

      // Step 4: exclude only "truly unbookable" room statuses
      // (current 'occupied'/'cleaning'/'dirty' rooms still accept future bookings).
      const roomWhere: any = {
        tenantId,
        status: { notIn: [...UNBOOKABLE_ROOM_STATUSES] },
      };
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

  private normalizeChildNoExtraChargeFields(
    dto: Pick<CreateRoomDto, 'childNoExtraCharge' | 'childNoExtraChargeNote'>,
    current?: {
      childNoExtraCharge?: boolean | null;
      childNoExtraChargeNote?: string | null;
    },
  ): {
    childNoExtraCharge?: boolean;
    childNoExtraChargeNote?: string | null;
  } {
    const hasFlag = dto.childNoExtraCharge !== undefined;
    const hasNote = dto.childNoExtraChargeNote !== undefined;

    if (!hasFlag && !hasNote) {
      return {};
    }

    // If explicitly setting to false, just return false and null note
    if (dto.childNoExtraCharge === false) {
      return {
        childNoExtraCharge: false,
        childNoExtraChargeNote: null,
      };
    }

    const note = dto.childNoExtraChargeNote?.trim();
    const effectiveFlag =
      dto.childNoExtraCharge !== undefined
        ? dto.childNoExtraCharge
        : (current?.childNoExtraCharge ?? false);
    const effectiveNote = hasNote ? note : current?.childNoExtraChargeNote?.trim();

    // If it's false, and an ACTUAL non-empty note is provided, throw error
    if (!effectiveFlag && hasNote && note) {
      throw new BadRequestException(
        'childNoExtraChargeNote can only be set when childNoExtraCharge is true',
      );
    }

    if (effectiveFlag) {
      if (!effectiveNote) {
        throw new BadRequestException(
          'childNoExtraChargeNote is required when childNoExtraCharge is true',
        );
      }

      return {
        childNoExtraCharge: true,
        childNoExtraChargeNote: effectiveNote,
      };
    }

    return {
      childNoExtraChargeNote: note ?? null,
    };
  }
}
