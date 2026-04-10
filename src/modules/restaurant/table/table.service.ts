import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { SaveLayoutDto } from './dto/save-layout.dto';

@Injectable()
export class TableService {
  private readonly logger = new Logger(TableService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async create(restaurantId: string, dto: CreateTableDto, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    const existing = await this.prisma.restaurantTable.findFirst({
      where: { restaurantId, tableNumber: dto.tableNumber },
    });

    if (existing) {
      throw new ConflictException(
        `Table number '${dto.tableNumber}' already exists in this restaurant`,
      );
    }

    return this.prisma.restaurantTable.create({
      data: { ...dto, restaurantId, tenantId },
    });
  }

  async update(
    restaurantId: string,
    tableId: string,
    dto: UpdateTableDto,
    tenantId: string,
  ) {
    await this.findOne(restaurantId, tableId, tenantId);

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

    return this.prisma.restaurantTable.update({
      where: { id: tableId },
      data: dto,
    });
  }

  async updateStatus(
    restaurantId: string,
    tableId: string,
    dto: UpdateTableStatusDto,
    tenantId: string,
  ) {
    await this.findOne(restaurantId, tableId, tenantId);

    return this.prisma.restaurantTable.update({
      where: { id: tableId },
      data: { status: dto.status },
    });
  }

  async saveLayout(restaurantId: string, dto: SaveLayoutDto, tenantId: string) {
    await this.validateRestaurant(restaurantId, tenantId);

    await this.prisma.$transaction(
      dto.tables.map(({ id, positionX, positionY, width, height, rotation }) =>
        this.prisma.restaurantTable.updateMany({
          where: { id, restaurantId, tenantId },
          data: { positionX, positionY, width, height, rotation },
        }),
      ),
    );

    return this.findAll(restaurantId, {}, tenantId);
  }

  async remove(restaurantId: string, tableId: string, tenantId: string) {
    const table = await this.findOne(restaurantId, tableId, tenantId);

    if (table.status === 'OCCUPIED') {
      throw new BadRequestException('Cannot delete an occupied table');
    }

    await this.prisma.restaurantTable.delete({ where: { id: tableId } });
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

    const reservationDate = new Date(date);
    reservationDate.setHours(0, 0, 0, 0);

    const reservedTableIds = await this.prisma.tableReservation.findMany({
      where: {
        restaurantId,
        tenantId,
        reservationDate,
        startTime: startTime,
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: { tableId: true },
    });

    const reservedIds = new Set(reservedTableIds.map((r) => r.tableId));

    return allTables.map((table) => ({
      ...table,
      isAvailable: !reservedIds.has(table.id) && table.status === 'AVAILABLE',
    }));
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
