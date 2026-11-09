import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWarehouseDto, WarehouseType } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { isVisibleOnChannel, WarehouseChannel } from './warehouse-channel';

interface FindAllOptions {
  propertyId?: string;
  type?: WarehouseType;
  /** แสดงเฉพาะคลังที่ระบบนี้มองเห็น (ตามกลุ่มคลัง) */
  channel?: WarehouseChannel;
}

const GROUP_SELECT = { select: { id: true, name: true, code: true, channels: true, isActive: true } };

@Injectable()
export class WarehousesService {
  private readonly logger = new Logger(WarehousesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all warehouses for a tenant with optional filtering
   */
  async findAll(tenantId: string, options?: FindAllOptions): Promise<any[]> {
    try {
      const where: any = {
        tenantId,
        deletedAt: null,
      };

      if (options?.propertyId) {
        where.propertyId = options.propertyId;
      }

      if (options?.type) {
        where.type = options.type;
      }

      const rows = await this.prisma.warehouse.findMany({
        where,
        include: {
          group: GROUP_SELECT,
          _count: {
            select: {
              warehouseStocks: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      const channel = options?.channel;
      if (!channel) return rows;
      // คลังของแถมไม่ใช่คลังขาย — ไม่โชว์ใน POS ไม่ว่าจะอยู่กลุ่มไหน
      return rows.filter(
        (w) =>
          isVisibleOnChannel(w.group, channel) &&
          !(channel === 'POS' && w.type === WarehouseType.PROMOTION),
      );
    } catch (error) {
      this.logger.error(`Error finding warehouses: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a single warehouse by ID
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    try {
      // Tenant-scoped model: use findFirst with tenantId (findUnique is blocked by TenantScope)
      const warehouse = await this.prisma.warehouse.findFirst({
        where: { id, tenantId },
        include: {
          group: GROUP_SELECT,
          _count: {
            select: {
              warehouseStocks: true,
            },
          },
        },
      });

      if (!warehouse) {
        throw new NotFoundException(`Warehouse with ID ${id} not found`);
      }

      if (warehouse.deletedAt) {
        throw new NotFoundException(`Warehouse with ID ${id} not found`);
      }

      return warehouse;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error finding warehouse ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a new warehouse
   * If isDefault is true, unset other defaults for the same property
   */
  async create(dto: CreateWarehouseDto, tenantId: string): Promise<any> {
    try {
      // Check for duplicate code within tenant
      const existing = await this.prisma.warehouse.findFirst({
        where: {
          tenantId,
          code: dto.code,
          deletedAt: null,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Warehouse with code ${dto.code} already exists for this tenant`,
        );
      }

      // Validate propertyId exists (tenant-scoped: findFirst with tenantId)
      const property = await this.prisma.property.findFirst({
        where: { id: dto.propertyId, tenantId },
      });

      if (!property) {
        throw new BadRequestException('Invalid propertyId');
      }

      if (dto.groupId) await this.assertGroupOwned(dto.groupId, tenantId);

      // If isDefault is true, unset other defaults for this property
      if (dto.isDefault) {
        await this.prisma.warehouse.updateMany({
          where: {
            tenantId,
            propertyId: dto.propertyId,
            isDefault: true,
            deletedAt: null,
          },
          data: {
            isDefault: false,
          },
        });
      }

      return await this.prisma.warehouse.create({
        data: {
          tenantId,
          name: dto.name,
          code: dto.code,
          propertyId: dto.propertyId,
          type: dto.type || WarehouseType.GENERAL,
          location: dto.location || null,
          isDefault: dto.isDefault || false,
          groupId: dto.groupId ?? null,
        },
        include: {
          _count: {
            select: {
              warehouseStocks: true,
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error creating warehouse: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update an existing warehouse
   * Handle isDefault toggle
   */
  async update(id: string, dto: UpdateWarehouseDto, tenantId: string): Promise<any> {
    try {
      const warehouse = await this.findOne(id, tenantId);

      // Check for duplicate code if code is being changed
      if (dto.code && dto.code !== warehouse.code) {
        const existing = await this.prisma.warehouse.findFirst({
          where: {
            tenantId,
            code: dto.code,
            id: { not: id },
            deletedAt: null,
          },
        });

        if (existing) {
          throw new ConflictException(
            `Warehouse with code ${dto.code} already exists for this tenant`,
          );
        }
      }

      // If propertyId is being changed, validate it (tenant-scoped: findFirst with tenantId)
      if (dto.propertyId && dto.propertyId !== warehouse.propertyId) {
        const property = await this.prisma.property.findFirst({
          where: { id: dto.propertyId, tenantId },
        });

        if (!property) {
          throw new BadRequestException('Invalid propertyId');
        }
      }

      if (dto.groupId) await this.assertGroupOwned(dto.groupId, tenantId);

      // Handle isDefault toggle
      const propertyId = dto.propertyId || warehouse.propertyId;
      if (dto.isDefault === true) {
        await this.prisma.warehouse.updateMany({
          where: {
            tenantId,
            propertyId,
            isDefault: true,
            id: { not: id },
            deletedAt: null,
          },
          data: {
            isDefault: false,
          },
        });
      }

      return await this.prisma.warehouse.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.code && { code: dto.code }),
          ...(dto.propertyId && { propertyId: dto.propertyId }),
          ...(dto.type && { type: dto.type }),
          ...(dto.location !== undefined && { location: dto.location }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.groupId !== undefined && { groupId: dto.groupId }),
        },
        include: {
          _count: {
            select: {
              warehouseStocks: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(`Error updating warehouse ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Soft delete a warehouse
   */
  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const warehouse = await this.findOne(id, tenantId);

      await this.prisma.warehouse.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      this.logger.log(`Warehouse ${id} soft deleted`);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error deleting warehouse ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async assertGroupOwned(groupId: string, tenantId: string): Promise<void> {
    const group = await this.prisma.warehouseGroup.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) throw new BadRequestException('ไม่พบกลุ่มคลังนี้');
  }
}
