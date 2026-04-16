import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto, ReservationStatusEnum } from './dto/update-reservation.dto';

@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(
    restaurantId: string,
    query: {
      date?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
    tenantId: string,
  ) {
    const { date, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      where.reservationDate = d;
    }

    const [data, total] = await Promise.all([
      this.prisma.tableReservation.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ reservationDate: 'asc' }, { startTime: 'asc' }],
        include: {
          table: { select: { id: true, tableNumber: true, capacity: true, zone: true } },
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

    // Check for conflicts
    const reservationDate = new Date(dto.reservationDate);
    reservationDate.setHours(0, 0, 0, 0);

    const conflict = await this.prisma.tableReservation.findFirst({
      where: {
        tableId: dto.tableId,
        reservationDate,
        startTime: dto.startTime,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    });

    if (conflict) {
      throw new ConflictException(
        `Table ${table.tableNumber} already has a reservation at ${dto.startTime} on this date`,
      );
    }

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

    const timestamps: Record<string, Date | null> = {};
    const now = new Date();

    if (dto.status === ReservationStatusEnum.CONFIRMED) timestamps.confirmedAt = now;
    if (dto.status === ReservationStatusEnum.SEATED) {
      timestamps.seatedAt = now;
      // Update table status to OCCUPIED
      await this.prisma.restaurantTable.update({
        where: { id: reservation.tableId },
        data: { status: 'OCCUPIED' },
      });
    }
    if (dto.status === ReservationStatusEnum.COMPLETED) {
      timestamps.completedAt = now;
      await this.prisma.restaurantTable.update({
        where: { id: reservation.tableId },
        data: { status: 'CLEANING' },
      });
    }
    if (dto.status === ReservationStatusEnum.CANCELLED) {
      timestamps.cancelledAt = now;
      if (reservation.status === ReservationStatusEnum.SEATED) {
        await this.prisma.restaurantTable.update({
          where: { id: reservation.tableId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    const updated = await this.prisma.tableReservation.update({
      where: { id: reservationId },
      data: { ...dto, ...timestamps },
      include: { table: true },
    });

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

    const updated = await this.prisma.tableReservation.update({
      where: { id: reservationId },
      data: { status: 'NO_SHOW', cancelledAt: new Date() },
    });

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

    await this.prisma.tableReservation.delete({ where: { id: reservationId } });

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
}
