import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { Prisma, RestaurantTable } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';
import {
  BLOCKING_RESERVATION_STATUSES,
  overlaps,
  startOfDay,
  today,
  toRange,
} from '../reservation/reservation-slot.util';

@Injectable()
export class TableService {
  private readonly logger = new Logger(TableService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(
    restaurantId: string,
    query: { status?: string; zone?: string; isActive?: string },
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const where: Record<string, unknown> = { restaurantId, tenantId };
    if (query.status) where.status = query.status;
    if (query.zone) where.zone = query.zone;
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    return this.prisma.restaurantTable.findMany({
      where,
      orderBy: { tableNumber: 'asc' },
      include: {
        // The floor view needs to see who is booked in and what is on the bill,
        // otherwise a RESERVED table gives staff no idea which party it is for.
        reservations: {
          where: {
            reservationDate: today(),
            status: { in: [...BLOCKING_RESERVATION_STATUSES] },
          },
          orderBy: { startTime: 'asc' },
          select: {
            id: true,
            guestName: true,
            guestPhone: true,
            partySize: true,
            startTime: true,
            endTime: true,
            status: true,
          },
        },
        orders: {
          where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            total: true,
          },
        },
      },
    });
  }

  async findOne(restaurantId: string, tableId: string, tenantId: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, restaurantId, tenantId },
    });

    if (!table) {
      throw new NotFoundException(`Table with ID ${tableId} not found`);
    }

    return table;
  }

  async create(restaurantId: string, dto: CreateTableDto, tenantId: string, userId?: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.restaurantTable.findFirst({
      where: { restaurantId, tableNumber: dto.tableNumber },
    });

    if (existing) {
      throw new ConflictException(
        `Table number '${dto.tableNumber}' already exists in this restaurant`,
      );
    }

    let result: RestaurantTable;
    try {
      result = await this.prisma.restaurantTable.create({
        data: { ...dto, restaurantId, tenantId },
      });
    } catch (error) {
      // Two people adding a table at once clear the check above and then hit
      // `restaurant_tables_restaurantId_tableNumber_key`. Say what happened
      // instead of putting the index name on screen.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          `Table number '${dto.tableNumber}' already exists in this restaurant`,
        );
      }
      throw error;
    }

    this.auditLogService.log({
      action: 'create' as any,
      resource: 'table' as any,
      category: 'restaurant' as any,
      resourceId: result.id,
      userId,
      tenantId,
      newValues: { tableNumber: dto.tableNumber, zone: dto.zone, capacity: dto.capacity },
      description: 'สร้างโต๊ะ: ' + (dto.tableNumber || ''),
    });

    return result;
  }

  async update(
    restaurantId: string,
    tableId: string,
    dto: UpdateTableDto,
    tenantId: string,
    userId?: string,
  ) {
    const oldTable = await this.findOne(restaurantId, tableId, tenantId);

    if (dto.tableNumber) {
      const conflict = await this.prisma.restaurantTable.findFirst({
        where: {
          restaurantId,
          tableNumber: dto.tableNumber,
          id: { not: tableId },
        },
      });

      if (conflict) {
        throw new ConflictException(
          `Table number '${dto.tableNumber}' already exists in this restaurant`,
        );
      }
    }

    const result = await this.prisma.restaurantTable.update({
      where: { id: tableId },
      data: dto,
    });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'table' as any,
      category: 'restaurant' as any,
      resourceId: tableId,
      userId,
      tenantId,
      // `status` is editable here too (the POS edit form submits the whole
      // table), so it has to be in the trail — not only on the status endpoint.
      oldValues: {
        tableNumber: oldTable.tableNumber,
        zone: oldTable.zone,
        capacity: oldTable.capacity,
        status: oldTable.status,
      },
      newValues: {
        tableNumber: result.tableNumber,
        zone: result.zone,
        capacity: result.capacity,
        status: result.status,
      },
      description: 'แก้ไขโต๊ะ',
    });

    return result;
  }

  async updateStatus(
    restaurantId: string,
    tableId: string,
    dto: UpdateTableStatusDto,
    tenantId: string,
    userId?: string,
  ) {
    const oldTable = await this.findOne(restaurantId, tableId, tenantId);

    const result = await this.prisma.restaurantTable.update({
      where: { id: tableId },
      data: { status: dto.status },
    });

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'table' as any,
      category: 'restaurant' as any,
      resourceId: tableId,
      userId,
      tenantId,
      oldValues: { status: oldTable.status },
      newValues: { status: result.status },
      description: 'เปลี่ยนสถานะโต๊ะ',
    });

    return result;
  }

  async saveLayout(restaurantId: string, dto: SaveLayoutDto, tenantId: string, userId?: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    await this.prisma.$transaction(
      dto.tables.map(({ id, positionX, positionY, width, height, rotation }) =>
        this.prisma.restaurantTable.updateMany({
          where: { id, restaurantId, tenantId },
          data: { positionX, positionY, width, height, rotation },
        }),
      ),
    );

    this.auditLogService.log({
      action: 'update' as any,
      resource: 'table' as any,
      category: 'restaurant' as any,
      resourceId: restaurantId,
      userId,
      tenantId,
      description: 'บันทึก layout ร้านอาหาร',
    });

    return this.findAll(restaurantId, {}, tenantId);
  }

  async remove(restaurantId: string, tableId: string, tenantId: string, userId?: string) {
    const table = await this.findOne(restaurantId, tableId, tenantId);

    if (table.status === 'OCCUPIED') {
      throw new BadRequestException('Cannot delete an occupied table');
    }

    // `TableReservation` cascades on delete, so removing a table would silently
    // wipe live bookings. Refuse instead — the caller has to cancel or move them.
    const liveBookings = await this.prisma.tableReservation.count({
      where: {
        tableId,
        restaurantId,
        status: { in: [...BLOCKING_RESERVATION_STATUSES] },
        reservationDate: { gte: today() },
      },
    });

    if (liveBookings > 0) {
      throw new BadRequestException(
        `Cannot delete this table — it still has ${liveBookings} upcoming reservation(s). Cancel or move them first.`,
      );
    }

    const openBills = await this.prisma.order.count({
      where: {
        tableId,
        restaurantId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });

    if (openBills > 0) {
      throw new BadRequestException(
        `Cannot delete this table — it still has ${openBills} open order(s). Close or cancel them first.`,
      );
    }

    await this.prisma.restaurantTable.delete({ where: { id: tableId } });

    this.auditLogService.log({
      action: 'delete' as any,
      resource: 'table' as any,
      category: 'restaurant' as any,
      resourceId: tableId,
      userId,
      tenantId,
      description: 'ลบโต๊ะ',
    });
  }

  async checkAvailability(
    restaurantId: string,
    query: { date: string; startTime: string; partySize?: number },
    tenantId: string,
  ) {
    await this.validateRestaurant(restaurantId, tenantId);

    const { date, startTime, partySize } = query;

    const whereCapacity: Record<string, unknown> = { restaurantId, tenantId, isActive: true };
    if (partySize) whereCapacity.capacity = { gte: Number(partySize) };

    const allTables = await this.prisma.restaurantTable.findMany({
      where: whereCapacity,
      orderBy: { capacity: 'asc' },
    });

    const reservationDate = startOfDay(date);

    const requested = toRange(startTime);
    if (!requested) {
      throw new BadRequestException(`Invalid start time '${startTime}' (expected HH:mm)`);
    }

    const sameDay = await this.prisma.tableReservation.findMany({
      where: {
        restaurantId,
        tenantId,
        reservationDate,
        status: { in: [...BLOCKING_RESERVATION_STATUSES] },
      },
      select: { tableId: true, startTime: true, endTime: true },
    });

    // Compare whole time ranges — matching only on an identical startTime would
    // report a table free at 18:30 while an 18:00–20:00 party is sitting at it.
    const reservedIds = new Set(
      sameDay
        .filter((r) => {
          const booked = toRange(r.startTime, r.endTime);
          return booked !== null && overlaps(requested, booked);
        })
        .map((r) => r.tableId),
    );

    return allTables.map((table) => ({
      ...table,
      isAvailable: !reservedIds.has(table.id) && table.status === 'AVAILABLE',
    }));
  }

  async generateTableQrCode(
    restaurantId: string,
    tableId: string,
    tenantId: string,
  ): Promise<{ qrCode: string; url: string }> {
    const table = await this.findOne(restaurantId, tableId, tenantId);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:9010';
    const qrUrl = `${frontendUrl}/restaurant/order/${tableId}?restaurantId=${restaurantId}`;

    try {
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 300,
        margin: 1,
      });

      return {
        qrCode: qrCodeDataUrl,
        url: qrUrl,
      };
    } catch (error) {
      this.logger.error(`Failed to generate QR code for table ${tableId}`, error);
      throw new BadRequestException('Failed to generate QR code');
    }
  }

  private async validateRestaurant(restaurantId: string, tenantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });

    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${restaurantId} not found`);
    }

    return restaurant;
  }
}
