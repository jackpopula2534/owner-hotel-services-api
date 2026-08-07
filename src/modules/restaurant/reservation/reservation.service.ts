import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { OrderService } from '../order/order.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto, ReservationStatusEnum } from './dto/update-reservation.dto';
import { QueryReservationsDto, ReservationSortEnum } from './dto/query-reservations.dto';
import {
  BLOCKING_RESERVATION_STATUSES,
  isToday,
  overlaps,
  startOfDay,
  toRange,
} from './reservation-slot.util';

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly orderService: OrderService,
  ) {}

  async findAll(restaurantId: string, query: QueryReservationsDto, tenantId: string) {
    const {
      date,
      from,
      to,
      status,
      page = 1,
      limit = 20,
      sort = ReservationSortEnum.SCHEDULE,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };
    if (status) where.status = status;

    // `date` pins one day; `from`/`to` span a range (the calendar's visible month).
    // Neither means "every booking we hold", which is what the full list wants.
    if (date) {
      where.reservationDate = startOfDay(date);
    } else if (from || to) {
      where.reservationDate = {
        ...(from ? { gte: startOfDay(from) } : {}),
        ...(to ? { lte: startOfDay(to) } : {}),
      };
    }

    const orderBy =
      sort === ReservationSortEnum.RECENT
        ? [{ createdAt: 'desc' as const }]
        : [{ reservationDate: 'asc' as const }, { startTime: 'asc' as const }];

    const [data, total] = await Promise.all([
      this.prisma.tableReservation.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy,
        include: {
          table: { select: { id: true, tableNumber: true, capacity: true, zone: true } },
          orders: {
            where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
            select: { id: true, orderNumber: true, status: true, total: true },
          },
        },
      }),
      this.prisma.tableReservation.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(restaurantId: string, reservationId: string, tenantId: string) {
    const reservation = await this.prisma.tableReservation.findFirst({
      where: { id: reservationId, restaurantId, tenantId },
      include: {
        table: true,
        orders: {
          select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true },
        },
      },
    });

    if (!reservation) {
      throw new NotFoundException(`Reservation with ID ${reservationId} not found`);
    }

    return reservation;
  }

  async create(restaurantId: string, dto: CreateReservationDto, tenantId: string, userId?: string) {
    // Validate table belongs to restaurant
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: dto.tableId, restaurantId, tenantId, isActive: true },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${dto.tableId} not found in this restaurant`);
    }

    // Check capacity
    if (dto.partySize > table.capacity) {
      throw new BadRequestException(
        `Party size (${dto.partySize}) exceeds table capacity (${table.capacity})`,
      );
    }

    const reservationDate = startOfDay(dto.reservationDate);

    await this.assertNoOverlap({
      tenantId,
      tableId: dto.tableId,
      tableNumber: table.tableNumber,
      reservationDate,
      startTime: dto.startTime,
      endTime: dto.endTime,
    });

    const created = await this.prisma.tableReservation.create({
      data: {
        ...dto,
        reservationDate,
        restaurantId,
        tenantId,
      },
      include: { table: true },
    });

    this.auditLogService.log({
      action: 'create' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: created.id,
      userId,
      tenantId,
      description: `สร้างการจองโต๊ะ: ${dto.guestName}`,
    });

    return created;
  }

  async update(
    restaurantId: string,
    reservationId: string,
    dto: UpdateReservationDto,
    tenantId: string,
    userId?: string,
  ) {
    const reservation = await this.findOne(restaurantId, reservationId, tenantId);

    if (
      reservation.status === ReservationStatusEnum.COMPLETED ||
      reservation.status === ReservationStatusEnum.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot update a ${reservation.status.toLowerCase()} reservation`,
      );
    }

    // Seating opens a bill, so it goes through its own flow rather than a bare status write.
    if (dto.status === ReservationStatusEnum.SEATED) {
      const { status, ...rest } = dto;
      if (Object.keys(rest).length > 0) {
        await this.update(restaurantId, reservationId, rest, tenantId, userId);
      }
      const seated = await this.seat(restaurantId, reservationId, tenantId, userId);
      return seated.reservation;
    }

    const tableId = dto.tableId ?? reservation.tableId;
    const reservationDate = dto.reservationDate
      ? startOfDay(dto.reservationDate)
      : reservation.reservationDate;
    const startTime = dto.startTime ?? reservation.startTime;
    const endTime = dto.endTime !== undefined ? dto.endTime : reservation.endTime;

    // Re-check the slot whenever the booking is moved — otherwise an edit can
    // silently drop a party onto a table that is already taken.
    const slotChanged =
      tableId !== reservation.tableId ||
      reservationDate.getTime() !== reservation.reservationDate.getTime() ||
      startTime !== reservation.startTime ||
      endTime !== reservation.endTime;

    if (slotChanged) {
      const table = await this.prisma.restaurantTable.findFirst({
        where: { id: tableId, restaurantId, tenantId, isActive: true },
      });
      if (!table) {
        throw new NotFoundException(`Table with ID ${tableId} not found in this restaurant`);
      }

      const partySize = dto.partySize ?? reservation.partySize;
      if (partySize > table.capacity) {
        throw new BadRequestException(
          `Party size (${partySize}) exceeds table capacity (${table.capacity})`,
        );
      }

      await this.assertNoOverlap({
        tenantId,
        tableId,
        tableNumber: table.tableNumber,
        reservationDate,
        startTime,
        endTime,
        excludeReservationId: reservationId,
      });
    }

    const timestamps: Record<string, Date | null> = {};
    const now = new Date();
    let nextTableStatus: string | null = null;

    if (dto.status === ReservationStatusEnum.CONFIRMED) {
      timestamps.confirmedAt = now;
      // Only hold the floor for today's bookings — confirming next week's party
      // must not take a table out of service now.
      if (isToday(reservationDate) && reservation.table.status === 'AVAILABLE') {
        nextTableStatus = 'RESERVED';
      }
    }

    if (dto.status === ReservationStatusEnum.COMPLETED) {
      timestamps.completedAt = now;
      nextTableStatus = 'CLEANING';
    }

    if (dto.status === ReservationStatusEnum.CANCELLED) {
      timestamps.cancelledAt = now;
      // Release the table only if this reservation is what was holding it.
      if (['OCCUPIED', 'RESERVED'].includes(reservation.table.status)) {
        nextTableStatus = 'AVAILABLE';
      }
    }

    const data: Record<string, unknown> = { ...dto, ...timestamps };
    if (dto.reservationDate) data.reservationDate = reservationDate;

    const [updated] = await this.prisma.$transaction([
      this.prisma.tableReservation.update({
        where: { id: reservationId },
        data,
        include: { table: true },
      }),
      ...(nextTableStatus
        ? [
            this.prisma.restaurantTable.update({
              where: { id: reservation.tableId },
              data: { status: nextTableStatus as never },
            }),
          ]
        : []),
    ]);

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: 'แก้ไขการจองโต๊ะ',
    });

    return updated;
  }

  /**
   * Seat a reservation: mark it SEATED, occupy the table, and open (or adopt)
   * the dine-in bill for that party. Safe to call twice — a reservation that is
   * already SEATED just gets its bill returned.
   */
  async seat(restaurantId: string, reservationId: string, tenantId: string, userId?: string) {
    const reservation = await this.findOne(restaurantId, reservationId, tenantId);

    if (!['PENDING', 'CONFIRMED', 'SEATED'].includes(reservation.status)) {
      throw new BadRequestException(`Cannot seat a ${reservation.status} reservation`);
    }

    if (reservation.status !== 'SEATED') {
      await this.prisma.$transaction([
        this.prisma.tableReservation.update({
          where: { id: reservationId },
          data: { status: 'SEATED', seatedAt: new Date() },
        }),
        this.prisma.restaurantTable.update({
          where: { id: reservation.tableId },
          data: { status: 'OCCUPIED' },
        }),
      ]);
    }

    const order = await this.attachOrder(restaurantId, reservation, tenantId, userId);

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: `รับลูกค้าเข้าโต๊ะ ${reservation.table.tableNumber}`,
    });

    return {
      reservation: await this.findOne(restaurantId, reservationId, tenantId),
      order,
    };
  }

  async markAsNoShow(
    restaurantId: string,
    reservationId: string,
    tenantId: string,
    userId?: string,
  ) {
    const reservation = await this.findOne(restaurantId, reservationId, tenantId);

    if (!['PENDING', 'CONFIRMED'].includes(reservation.status)) {
      throw new BadRequestException(`Cannot mark a ${reservation.status} reservation as no-show`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.tableReservation.update({
        where: { id: reservationId },
        data: { status: 'NO_SHOW', cancelledAt: new Date() },
      }),
      // A no-show must hand the table back to the floor.
      ...(reservation.table.status === 'RESERVED'
        ? [
            this.prisma.restaurantTable.update({
              where: { id: reservation.tableId },
              data: { status: 'AVAILABLE' as never },
            }),
          ]
        : []),
    ]);

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: 'บันทึกลูกค้าไม่มา (No Show)',
    });

    return updated;
  }

  async remove(restaurantId: string, reservationId: string, tenantId: string, userId?: string) {
    const reservation = await this.findOne(restaurantId, reservationId, tenantId);

    if (['SEATED', 'COMPLETED'].includes(reservation.status)) {
      throw new BadRequestException(`Cannot delete a ${reservation.status} reservation`);
    }

    await this.prisma.$transaction([
      this.prisma.tableReservation.delete({ where: { id: reservationId } }),
      ...(reservation.table.status === 'RESERVED'
        ? [
            this.prisma.restaurantTable.update({
              where: { id: reservation.tableId },
              data: { status: 'AVAILABLE' as never },
            }),
          ]
        : []),
    ]);

    this.auditLogService.log({
      action: 'delete' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: 'ลบการจองโต๊ะ',
    });
  }

  /**
   * Reject a booking whose time window collides with another live booking on the
   * same table. Compares full ranges — matching only on startTime would let an
   * 18:30 party land inside an 18:00–20:00 one.
   */
  private async assertNoOverlap(params: {
    tenantId: string;
    tableId: string;
    tableNumber: string;
    reservationDate: Date;
    startTime: string;
    endTime?: string | null;
    excludeReservationId?: string;
  }): Promise<void> {
    const range = toRange(params.startTime, params.endTime);
    if (!range) {
      throw new BadRequestException(`Invalid reservation time '${params.startTime}' (expected HH:mm)`);
    }

    const sameDay = await this.prisma.tableReservation.findMany({
      where: {
        tenantId: params.tenantId,
        tableId: params.tableId,
        reservationDate: params.reservationDate,
        status: { in: [...BLOCKING_RESERVATION_STATUSES] },
        ...(params.excludeReservationId ? { id: { not: params.excludeReservationId } } : {}),
      },
      select: { startTime: true, endTime: true },
    });

    const clash = sameDay.find((existing) => {
      const other = toRange(existing.startTime, existing.endTime);
      return other !== null && overlaps(range, other);
    });

    if (clash) {
      throw new ConflictException(
        `Table ${params.tableNumber} is already booked ${clash.startTime}` +
          `${clash.endTime ? `-${clash.endTime}` : ''} on this date`,
      );
    }
  }

  /**
   * Give a seated party a bill: adopt the table's open order if one exists,
   * otherwise open an empty dine-in order. Failing to open the bill must not
   * un-seat a party that is physically at the table, so this only logs.
   */
  private async attachOrder(
    restaurantId: string,
    reservation: { id: string; tableId: string; guestName: string; partySize: number },
    tenantId: string,
    userId?: string,
  ) {
    const existing = await this.prisma.order.findFirst({
      where: {
        restaurantId,
        tenantId,
        tableId: reservation.tableId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      if (existing.reservationId === reservation.id) return existing;
      return this.prisma.order.update({
        where: { id: existing.id },
        data: { reservationId: reservation.id },
      });
    }

    try {
      return await this.orderService.create(
        restaurantId,
        {
          tableId: reservation.tableId,
          orderType: 'DINE_IN',
          guestName: reservation.guestName,
          partySize: reservation.partySize,
          reservationId: reservation.id,
        } as never,
        tenantId,
        userId,
      );
    } catch (error) {
      this.logger.error(
        `Seated reservation ${reservation.id} but could not open its order`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }
}
