import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto, ReservationStatusEnum } from './dto/update-reservation.dto';
import { QueryReservationsDto, ReservationSortEnum } from './dto/query-reservations.dto';
import { MoveReservationTableDto } from './dto/move-reservation-table.dto';

/** One entry of `TableReservation.tableMoves`. */
export interface TableMoveEntry {
  fromTableId: string;
  fromTableNumber: string;
  toTableId: string;
  toTableNumber: string;
  reason: string;
  at: string;
  byUserId: string | null;
  byName: string | null;
}
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
          // status: the detail sheet tells staff what each action will do to the table.
          table: { select: { id: true, tableNumber: true, capacity: true, zone: true, status: true } },
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
    const reservationDate = startOfDay(dto.reservationDate);

    // A booking may be taken without a table; the slot is only checked once
    // one is named (here, or later when the party orders).
    if (dto.tableId) {
      await this.assertTableFits({
        restaurantId,
        tenantId,
        tableId: dto.tableId,
        partySize: dto.partySize,
        reservationDate,
        startTime: dto.startTime,
        endTime: dto.endTime,
      });
    } else if (!toRange(dto.startTime, dto.endTime)) {
      throw new BadRequestException(`Invalid reservation time '${dto.startTime}' (expected HH:mm)`);
    }

    const created = await this.prisma.tableReservation.create({
      // (cast: tableId is optional since 20261027160000_reservation_optional_table)
      data: {
        ...dto,
        reservationDate,
        restaurantId,
        tenantId,
      } as unknown as Prisma.TableReservationUncheckedCreateInput,
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

    const tableId: string | null = dto.tableId ?? reservation.tableId ?? null;
    const previousTableId: string | null = reservation.tableId ?? null;
    const tableChanged = tableId !== previousTableId;

    // A seated party is moved only through moveTable(): it asks for a reason,
    // moves the bills and logs the move. A plain edit must not do it silently.
    // (Giving a table to a seated party that has none is still a plain edit.)
    if (tableChanged && previousTableId && reservation.status === 'SEATED') {
      throw new BadRequestException('ลูกค้านั่งแล้ว — ย้ายโต๊ะผ่าน "ย้ายโต๊ะ" ในใบการจอง');
    }
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

    if (slotChanged && tableId) {
      await this.assertTableFits({
        restaurantId,
        tenantId,
        tableId,
        partySize: dto.partySize ?? reservation.partySize,
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
    const currentTable = reservation.table as { status: string } | null;

    // Giving the booking a (different) table: the party's live bills move with
    // it, the new table is held / occupied like the old one was, and the old
    // table is handed back when nothing else is running on it.
    if (tableChanged && tableId && !dto.status) {
      const live = ['PENDING', 'CONFIRMED', 'SEATED'].includes(reservation.status);
      if (live) {
        if (reservation.status === 'SEATED') {
          extraOps.push(
            this.prisma.order.updateMany({
              where: { reservationId, tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
              data: { tableId },
            }),
            this.prisma.restaurantTable.update({ where: { id: tableId }, data: { status: 'OCCUPIED' as never } }),
          );
        } else if (reservation.status === 'CONFIRMED' && isToday(reservationDate)) {
          extraOps.push(
            this.prisma.restaurantTable.updateMany({
              where: { id: tableId, status: 'AVAILABLE' as never },
              data: { status: 'RESERVED' as never },
            }),
          );
        }
        if (previousTableId && currentTable && ['OCCUPIED', 'RESERVED'].includes(currentTable.status)) {
          const othersOnOldTable = await this.prisma.order.count({
            where: {
              tableId: previousTableId,
              tenantId,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
              items: { some: {} },
              NOT: { reservationId },
            },
          });
          if (othersOnOldTable === 0) {
            extraOps.push(
              this.prisma.restaurantTable.update({
                where: { id: previousTableId },
                data: { status: 'AVAILABLE' as never },
              }),
            );
          }
        }
      }
    }

    if (dto.status === ReservationStatusEnum.CONFIRMED) {
      timestamps.confirmedAt = now;
      // Only hold the floor for today's bookings — confirming next week's party
      // must not take a table out of service now.
      if (isToday(reservationDate) && currentTable?.status === 'AVAILABLE') {
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
      const liveBillsOnTable = !tableId ? 0 : await this.prisma.order.count({
        where: {
          tableId,
          tenantId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          id: { notIn: emptyBillIds },
          items: { some: {} },
        },
      });
      nextTableStatus = !tableId || liveBillsOnTable > 0 ? null : 'CLEANING';
    }

    if (dto.status === ReservationStatusEnum.CANCELLED) {
      timestamps.cancelledAt = now;
      // Release the table only if this reservation is what was holding it.
      if (currentTable && ['OCCUPIED', 'RESERVED'].includes(currentTable.status)) {
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
      ...(nextTableStatus && tableId
        ? [
            this.prisma.restaurantTable.update({
              where: { id: tableId },
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

    // A party booked without a table can still be checked in; the table (and
    // its OCCUPIED status) follows when staff pick one for the first order.
    const tableId = reservation.tableId ?? null;
    if (reservation.status !== 'SEATED') {
      await this.prisma.$transaction([
        this.prisma.tableReservation.update({
          where: { id: reservationId },
          data: { status: 'SEATED', seatedAt: new Date() },
        }),
        ...(tableId
          ? [this.prisma.restaurantTable.update({ where: { id: tableId }, data: { status: 'OCCUPIED' as never } })]
          : []),
      ]);
    }

    const order = tableId
      ? await this.adoptOpenBill(restaurantId, { id: reservation.id, tableId }, tenantId)
      : null;
    const tableNumber = (reservation.table as { tableNumber?: string } | null)?.tableNumber;

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: tableNumber ? `รับลูกค้าเข้าโต๊ะ ${tableNumber}` : `รับลูกค้าเข้าร้าน (ยังไม่ระบุโต๊ะ): ${reservation.guestName}`,
    });

    return {
      reservation: await this.findOne(restaurantId, reservationId, tenantId),
      order,
    };
  }

  /**
   * Move a booking to another table, with a reason.
   *  - the new table must seat the party and be free for the booking's slot
   *    (and, for a seated party, not have anyone sitting at it);
   *  - the booking's open bills move with it, so the kitchen and the floor
   *    serve the new table;
   *  - a seated party leaves its old table for CLEANING (unless another bill is
   *    still running there); a party not yet seated just releases the hold;
   *  - the move is appended to `tableMoves` for the booking timeline.
   */
  async moveTable(
    restaurantId: string,
    reservationId: string,
    dto: MoveReservationTableDto,
    tenantId: string,
    userId?: string,
  ) {
    const reservation = await this.findOne(restaurantId, reservationId, tenantId);
    const status = reservation.status as string;
    if (!['PENDING', 'CONFIRMED', 'SEATED'].includes(status)) {
      throw new BadRequestException(`ย้ายโต๊ะไม่ได้ — การจองนี้${status === 'COMPLETED' ? 'ปิดแล้ว' : 'ไม่อยู่ในสถานะที่ใช้งาน'}`);
    }
    const fromTableId = reservation.tableId ?? null;
    const fromTable = reservation.table as { id: string; tableNumber: string; status: string } | null;
    if (!fromTableId || !fromTable) {
      throw new BadRequestException('การจองนี้ยังไม่มีโต๊ะ — เลือกโต๊ะตอนสั่งอาหาร');
    }
    if (dto.tableId === fromTableId) {
      throw new BadRequestException('เลือกโต๊ะอื่นที่ไม่ใช่โต๊ะเดิม');
    }

    const target = await this.assertTableFits({
      restaurantId,
      tenantId,
      tableId: dto.tableId,
      partySize: reservation.partySize,
      reservationDate: reservation.reservationDate,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      excludeReservationId: reservationId,
    });
    if (target.status === 'CLEANING' || target.status === 'OUT_OF_SERVICE') {
      throw new BadRequestException(`โต๊ะ ${target.tableNumber} ยังใช้ไม่ได้ (${target.status === 'CLEANING' ? 'ทำความสะอาด' : 'ปิดใช้งาน'})`);
    }
    const seated = status === 'SEATED';
    if (seated) {
      const busy = await this.prisma.order.count({
        where: { tableId: dto.tableId, tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] }, items: { some: {} } },
      });
      if (busy > 0 || target.status === 'OCCUPIED') {
        throw new ConflictException(`โต๊ะ ${target.tableNumber} มีลูกค้าอยู่`);
      }
    }

    const othersOnOldTable = await this.prisma.order.count({
      where: {
        tableId: fromTableId,
        tenantId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        items: { some: {} },
        NOT: { reservationId },
      },
    });

    const by = userId
      ? ((await this.prisma.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true },
        })) as { firstName: string | null; lastName: string | null; email: string } | null)
      : null;
    const byName = by ? [by.firstName, by.lastName].filter(Boolean).join(' ') || by.email : null;

    const reason = dto.reason.trim();
    const entry: TableMoveEntry = {
      fromTableId,
      fromTableNumber: fromTable.tableNumber,
      toTableId: target.id,
      toTableNumber: target.tableNumber,
      reason,
      at: new Date().toISOString(),
      byUserId: userId ?? null,
      byName,
    };
    const previousMoves = Array.isArray((reservation as { tableMoves?: unknown }).tableMoves)
      ? ((reservation as { tableMoves?: unknown }).tableMoves as TableMoveEntry[])
      : [];

    const today = isToday(reservation.reservationDate);
    const oldNext = seated
      ? othersOnOldTable > 0 ? null : 'CLEANING'
      : fromTable.status === 'RESERVED' ? 'AVAILABLE' : null;
    const newNext = seated ? 'OCCUPIED' : today && target.status === 'AVAILABLE' && status === 'CONFIRMED' ? 'RESERVED' : null;

    const ops: unknown[] = [
      this.prisma.tableReservation.update({
        where: { id: reservationId },
        data: { tableId: target.id, tableMoves: [...previousMoves, entry] } as never,
      }),
      this.prisma.order.updateMany({
        where: { reservationId, tenantId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        data: { tableId: target.id },
      }),
    ];
    if (oldNext) ops.push(this.prisma.restaurantTable.update({ where: { id: fromTableId }, data: { status: oldNext as never } }));
    if (newNext) ops.push(this.prisma.restaurantTable.update({ where: { id: target.id }, data: { status: newNext as never } }));
    await this.prisma.$transaction(ops as never[]);

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'reservation' as any,
      category: 'restaurant' as any,
      resourceId: reservationId,
      userId,
      tenantId,
      description: `ย้ายโต๊ะ ${fromTable.tableNumber} → ${target.tableNumber}: ${reason}`,
    });

    return this.findOne(restaurantId, reservationId, tenantId);
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
      ...(reservation.tableId && (reservation.table as { status: string } | null)?.status === 'RESERVED'
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
      ...(reservation.tableId && (reservation.table as { status: string } | null)?.status === 'RESERVED'
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

  /** The table exists here, seats the party, and is free for the slot. */
  private async assertTableFits(params: {
    restaurantId: string;
    tenantId: string;
    tableId: string;
    partySize: number;
    reservationDate: Date;
    startTime: string;
    endTime?: string | null;
    excludeReservationId?: string;
  }): Promise<{ id: string; tableNumber: string; capacity: number; status: string }> {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: params.tableId, restaurantId: params.restaurantId, tenantId: params.tenantId, isActive: true },
    });
    if (!table) {
      throw new NotFoundException(`Table with ID ${params.tableId} not found in this restaurant`);
    }
    if (params.partySize > table.capacity) {
      throw new BadRequestException(
        `Party size (${params.partySize}) exceeds table capacity (${table.capacity})`,
      );
    }
    await this.assertNoOverlap({
      tenantId: params.tenantId,
      tableId: params.tableId,
      tableNumber: table.tableNumber,
      reservationDate: params.reservationDate,
      startTime: params.startTime,
      endTime: params.endTime,
      excludeReservationId: params.excludeReservationId,
    });
    return table as unknown as { id: string; tableNumber: string; capacity: number; status: string };
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
