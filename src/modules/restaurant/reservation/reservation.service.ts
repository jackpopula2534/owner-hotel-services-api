import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(restaurantId: string, query: QueryReservationsDto, tenantId: string) {
    const {
      date,
      from,
      to,
      status,
      tableId,
      page = 1,
      limit = 20,
      sort = ReservationSortEnum.SCHEDULE,
    } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };
    if (status) where.status = status;
    if (tableId) where.tableId = tableId;

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
          // Live bills only, and only ones that actually hold food — an item-less
          // order is not a bill and must not show up as one on the floor.
          orders: {
            where: { status: { notIn: ['COMPLETED', 'CANCELLED'] }, items: { some: {} } },
            select: {
              id: true,
              orderNumber: true,
              status: true,
              paymentStatus: true,
              total: true,
            },
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
          where: { items: { some: {} } },
          select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true },
          orderBy: { createdAt: 'desc' },
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
    // Extra writes that have to land in the same transaction as the status change
    // (closing a booking also tidies up the bills it left behind).
    const extraOps: unknown[] = [];

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

      // Closing a booking must not strand its bills: a real bill that nobody has
      // paid blocks the close outright, an item-less bill is a leftover and gets
      // cancelled so it stops showing up on the kitchen display.
      const emptyBillIds = await this.assertBillsSettled(reservation.id, tenantId);
      if (emptyBillIds.length > 0) {
        extraOps.push(
          this.prisma.order.updateMany({
            where: { id: { in: emptyBillIds } },
            data: { status: 'CANCELLED', cancelledAt: now },
          }),
        );
      }

      // Only send the table to CLEANING once nothing real is still running on it —
      // a split bill from another party must keep it OCCUPIED.
      const liveBillsOnTable = await this.prisma.order.count({
        where: {
          tableId: reservation.tableId,
          tenantId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          id: { notIn: emptyBillIds },
          items: { some: {} },
        },
      });
      nextTableStatus = liveBillsOnTable > 0 ? null : 'CLEANING';
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
      ...(extraOps as never[]),
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
   * Seat a reservation: mark it SEATED and occupy the table. It deliberately does
   * NOT open a bill — an order with no items would be pushed onto the kitchen
   * display as a phantom ticket. The bill is created by the first actual order
   * and links itself back here (see OrderService.resolveReservationId).
   * Safe to call twice — a reservation that is already SEATED just gets its
   * current bill returned.
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

    const order = await this.adoptOpenBill(restaurantId, reservation, tenantId);

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
   * Hand the seated party whichever bill is already open on their table (a walk-in
   * order rung up before the booking was seated), linking it to the booking so
   * paying it closes both. Returns null when the party has not ordered yet — that
   * is the normal case and must never fabricate an empty bill.
   */
  private async adoptOpenBill(
    restaurantId: string,
    reservation: { id: string; tableId: string },
    tenantId: string,
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

    if (!existing) return null;
    if (existing.reservationId === reservation.id) return existing;

    // Don't steal a bill that belongs to a different booking on the same table.
    if (existing.reservationId) return null;

    return this.prisma.order.update({
      where: { id: existing.id },
      data: { reservationId: reservation.id },
    });
  }

  /**
   * Guard the close of a booking against its bills. Throws when a bill with items
   * is still unpaid; returns the ids of item-less bills, which are leftovers the
   * caller cancels inside the same transaction.
   */
  private async assertBillsSettled(reservationId: string, tenantId: string): Promise<string[]> {
    const bills = await this.prisma.order.findMany({
      where: {
        reservationId,
        tenantId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        paymentStatus: true,
        _count: { select: { items: true } },
      },
    });

    const unpaid = bills.filter((b) => b._count.items > 0 && b.paymentStatus !== 'PAID');
    if (unpaid.length > 0) {
      const list = unpaid
        .map((b) => `${b.orderNumber} (฿${Number(b.total).toLocaleString('th-TH')})`)
        .join(', ');
      throw new BadRequestException(
        `ปิดการจองไม่ได้ — ยังมีบิลค้างชำระ: ${list} กรุณาชำระเงินหรือยกเลิกบิลก่อน`,
      );
    }

    return bills.filter((b) => b._count.items === 0).map((b) => b.id);
  }
}
