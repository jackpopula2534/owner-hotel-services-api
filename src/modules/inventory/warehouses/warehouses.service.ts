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

interface FindAllOptions {
  propertyId?: string;
  type?: WarehouseType;
}

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

      return await this.prisma.warehouse.findMany({
        where,
        include: {
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
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id },
        include: {
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

      if (warehouse.tenantId !== tenantId) {
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

      // Validate propertyId exists
      const property = await this.prisma.property.findUnique({
        where: { id: dto.propertyId },
      });

      if (!property || property.tenantId !== tenantId) {
        throw new BadRequestException('Invalid propertyId');
      }

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

      // If propertyId is being changed, validate it
      if (dto.propertyId && dto.propertyId !== warehouse.propertyId) {
        const property = await this.prisma.property.findUnique({
          where: { id: dto.propertyId },
        });

        if (!property || property.tenantId !== tenantId) {
          throw new BadRequestException('Invalid propertyId');
        }
      }

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
}
