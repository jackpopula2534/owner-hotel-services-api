import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCostTypeDto, CostTypeCategory } from './dto/create-cost-type.dto';
import { UpdateCostTypeDto } from './dto/update-cost-type.dto';

export interface CostType {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  category: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CostTypesService {
  private readonly logger = new Logger(CostTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all cost types
   * Optionally filter by category
   */
  async findAll(tenantId: string, category?: string): Promise<CostType[]> {
    try {
      const where: any = {
        tenantId,
      };

      if (category) {
        where.category = category;
      }

      const costTypes = await this.prisma.costType.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return costTypes;
    } catch (error) {
      this.logger.error(
        `Failed to find cost types`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single cost type by ID
   */
  async findOne(id: string, tenantId: string): Promise<CostType> {
    try {
      const costType = await this.prisma.costType.findUnique({
        where: { id },
      });

      if (!costType) {
        throw new NotFoundException(`Cost type with ID ${id} not found`);
      }

      if (costType.tenantId !== tenantId) {
        throw new NotFoundException(`Cost type with ID ${id} not found`);
      }

      return costType;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to find cost type ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Create a new cost type
   * Validates unique code per tenant
   */
  async create(dto: CreateCostTypeDto, tenantId: string): Promise<CostType> {
    try {
      // Validate unique code per tenant
      const existingCode = await this.prisma.costType.findFirst({
        where: {
          tenantId,
          code: dto.code,
        },
      });

      if (existingCode) {
        throw new ConflictException(`Cost type code "${dto.code}" already exists for this tenant`);
      }

      const costType = await this.prisma.costType.create({
        data: {
          tenantId,
          name: dto.name,
          code: dto.code,
          category: dto.category,
          description: dto.description || null,
          sortOrder: dto.sortOrder || 0,
          isActive: true,
        },
      });

      return costType;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Failed to create cost type`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update a cost type
   */
  async update(id: string, dto: UpdateCostTypeDto, tenantId: string): Promise<CostType> {
    try {
      const costType = await this.prisma.costType.findUnique({
        where: { id },
      });

      if (!costType || costType.tenantId !== tenantId) {
        throw new NotFoundException(`Cost type with ID ${id} not found`);
      }

      // Validate unique code if updating code
      if (dto.code && dto.code !== costType.code) {
        const existingCode = await this.prisma.costType.findFirst({
          where: {
            tenantId,
            code: dto.code,
            NOT: { id },
          },
        });

        if (existingCode) {
          throw new ConflictException(
            `Cost type code "${dto.code}" already exists for this tenant`,
          );
        }
      }

      const updated = await this.prisma.costType.update({
        where: { id },
        data: {
          name: dto.name ?? costType.name,
          code: dto.code ?? costType.code,
          category: dto.category ?? costType.category,
          description: dto.description !== undefined ? dto.description : costType.description,
          sortOrder: dto.sortOrder !== undefined ? dto.sortOrder : costType.sortOrder,
        },
      });

      return updated;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Failed to update cost type ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Deactivate a cost type (set isActive=false)
   * Check no entries exist
   */
  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const costType = await this.prisma.costType.findUnique({
        where: { id },
      });

      if (!costType || costType.tenantId !== tenantId) {
        throw new NotFoundException(`Cost type with ID ${id} not found`);
      }

      // Check if there are any cost entries using this cost type
      const hasEntries = await this.prisma.costEntry.count({
        where: {
          costTypeId: id,
        },
      });

      if (hasEntries > 0) {
        throw new BadRequestException(`Cannot delete cost type with ${hasEntries} active entries`);
      }

      await this.prisma.costType.update({
        where: { id },
        data: {
          isActive: false,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to delete cost type ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Seed default cost types for a tenant
   * Creates standard cost types across all categories
   */
  async seedDefaults(tenantId: string): Promise<CostType[]> {
    try {
      const defaults = [
        // MATERIAL
        {
          name: 'Room Amenities',
          code: 'CT-AMEN',
          category: CostTypeCategory.MATERIAL,
          description: 'Toiletries and amenities for guest rooms',
          sortOrder: 1,
        },
        {
          name: 'F&B Ingredients',
          code: 'CT-INGR',
          category: CostTypeCategory.MATERIAL,
          description: 'Food and beverage ingredients',
          sortOrder: 2,
        },
        {
          name: 'Maintenance Parts',
          code: 'CT-PARTS',
          category: CostTypeCategory.MATERIAL,
          description: 'Replacement parts and equipment materials',
          sortOrder: 3,
        },
        {
          name: 'Cleaning Supplies',
          code: 'CT-CLEAN',
          category: CostTypeCategory.MATERIAL,
          description: 'Cleaning chemicals and supplies',
          sortOrder: 4,
        },
        // LABOR
        {
          name: 'Staff Salary',
          code: 'CT-SAL',
          category: CostTypeCategory.LABOR,
          description: 'Employee salaries and wages',
          sortOrder: 5,
        },
        {
          name: 'Staff Benefits',
          code: 'CT-BEN',
          category: CostTypeCategory.LABOR,
          description: 'Employee benefits and allowances',
          sortOrder: 6,
        },
        {
          name: 'Overtime',
          code: 'CT-OT',
          category: CostTypeCategory.LABOR,
          description: 'Overtime compensation',
          sortOrder: 7,
        },
        // OVERHEAD
        {
          name: 'Electricity',
          code: 'CT-ELEC',
          category: CostTypeCategory.OVERHEAD,
          description: 'Electrical utility costs',
          sortOrder: 8,
        },
        {
          name: 'Water',
          code: 'CT-WATER',
          category: CostTypeCategory.OVERHEAD,
          description: 'Water utility costs',
          sortOrder: 9,
        },
        {
          name: 'Depreciation',
          code: 'CT-DEPR',
          category: CostTypeCategory.OVERHEAD,
          description: 'Asset depreciation expense',
          sortOrder: 10,
        },
        {
          name: 'Insurance',
          code: 'CT-INS',
          category: CostTypeCategory.OVERHEAD,
          description: 'Insurance premiums',
          sortOrder: 11,
        },
        {
          name: 'Rent',
          code: 'CT-RENT',
          category: CostTypeCategory.OVERHEAD,
          description: 'Rent and lease payments',
          sortOrder: 12,
        },
        // REVENUE
        {
          name: 'Room Revenue',
          code: 'CT-RREV',
          category: CostTypeCategory.REVENUE,
          description: 'Room rental revenue',
          sortOrder: 13,
        },
        {
          name: 'F&B Revenue',
          code: 'CT-FBREV',
          category: CostTypeCategory.REVENUE,
          description: 'Food and beverage revenue',
          sortOrder: 14,
        },
        {
          name: 'Other Revenue',
          code: 'CT-OREV',
          category: CostTypeCategory.REVENUE,
          description: 'Other miscellaneous revenue',
          sortOrder: 15,
        },
      ];

      const created = await Promise.all(
        defaults.map((defaultCt) =>
          this.prisma.costType.create({
            data: {
              tenantId,
              name: defaultCt.name,
              code: defaultCt.code,
              category: defaultCt.category,
              description: defaultCt.description,
              sortOrder: defaultCt.sortOrder,
              isActive: true,
            },
          }),
        ),
      );

      this.logger.log(`Seeded ${created.length} default cost types for tenant ${tenantId}`);

      return created;
    } catch (error) {
      this.logger.error(
        `Failed to seed default cost types`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
