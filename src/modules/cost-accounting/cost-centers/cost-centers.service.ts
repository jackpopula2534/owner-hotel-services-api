import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCostCenterDto, CostCenterTypeEnum } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

export interface CostCenterWithRelations {
  id: string;
  tenantId: string;
  propertyId: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  parentId: string | null;
  managerId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  childrenCount?: number;
  lastMonthTotal?: number;
  parent?: CostCenterWithRelations | null;
  children?: CostCenterWithRelations[];
}

@Injectable()
export class CostCentersService {
  private readonly logger = new Logger(CostCentersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all cost centers for a property
   * Include children count and last month's total cost
   */
  async findAll(tenantId: string, propertyId: string): Promise<CostCenterWithRelations[]> {
    try {
      const costCenters = await this.prisma.costCenter.findMany({
        where: {
          tenantId,
          propertyId,
        },
        include: {
          _count: {
            select: {
              children: true,
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      // Map to include childrenCount
      return costCenters.map((cc) => ({
        ...cc,
        childrenCount: cc._count.children,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to find cost centers for property ${propertyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Find single cost center with children, parent, and recent cost entries summary
   */
  async findOne(id: string, tenantId: string): Promise<CostCenterWithRelations> {
    try {
      const costCenter = await this.prisma.costCenter.findUnique({
        where: { id },
        include: {
          parent: true,
          children: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      });

      if (!costCenter) {
        throw new NotFoundException(`Cost center with ID ${id} not found`);
      }

      if (costCenter.tenantId !== tenantId) {
        throw new NotFoundException(`Cost center with ID ${id} not found`);
      }

      return costCenter;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to find cost center ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Create a new cost center
   * Validates unique code per property+tenant and parentId
   */
  async create(dto: CreateCostCenterDto, tenantId: string): Promise<CostCenterWithRelations> {
    try {
      // Validate unique code per property+tenant
      const existingCode = await this.prisma.costCenter.findFirst({
        where: {
          tenantId,
          propertyId: dto.propertyId,
          code: dto.code,
        },
      });

      if (existingCode) {
        throw new ConflictException(
          `Cost center code "${dto.code}" already exists for this property`,
        );
      }

      // Validate parentId if provided
      if (dto.parentId) {
        const parent = await this.prisma.costCenter.findUnique({
          where: { id: dto.parentId },
        });

        if (!parent || parent.tenantId !== tenantId) {
          throw new BadRequestException('Invalid parent cost center ID');
        }

        if (parent.propertyId !== dto.propertyId) {
          throw new BadRequestException('Parent cost center must belong to the same property');
        }
      }

      const costCenter = await this.prisma.costCenter.create({
        data: {
          tenantId,
          propertyId: dto.propertyId,
          name: dto.name,
          code: dto.code,
          type: dto.type,
          description: dto.description || null,
          parentId: dto.parentId || null,
          managerId: dto.managerId || null,
          sortOrder: dto.sortOrder || 0,
          isActive: true,
        },
        include: {
          parent: true,
          children: true,
        },
      });

      return costCenter;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to create cost center`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Update a cost center
   */
  async update(
    id: string,
    dto: UpdateCostCenterDto,
    tenantId: string,
  ): Promise<CostCenterWithRelations> {
    try {
      const costCenter = await this.prisma.costCenter.findUnique({
        where: { id },
      });

      if (!costCenter || costCenter.tenantId !== tenantId) {
        throw new NotFoundException(`Cost center with ID ${id} not found`);
      }

      // Validate unique code if updating code
      if (dto.code && dto.code !== costCenter.code) {
        const existingCode = await this.prisma.costCenter.findFirst({
          where: {
            tenantId,
            propertyId: costCenter.propertyId,
            code: dto.code,
            NOT: { id },
          },
        });

        if (existingCode) {
          throw new ConflictException(
            `Cost center code "${dto.code}" already exists for this property`,
          );
        }
      }

      // Validate parentId if updating
      if (dto.parentId && dto.parentId !== costCenter.parentId) {
        const parent = await this.prisma.costCenter.findUnique({
          where: { id: dto.parentId },
        });

        if (!parent || parent.tenantId !== tenantId) {
          throw new BadRequestException('Invalid parent cost center ID');
        }

        if (parent.propertyId !== costCenter.propertyId) {
          throw new BadRequestException('Parent cost center must belong to the same property');
        }
      }

      const updated = await this.prisma.costCenter.update({
        where: { id },
        data: {
          name: dto.name ?? costCenter.name,
          code: dto.code ?? costCenter.code,
          type: dto.type ?? costCenter.type,
          description: dto.description !== undefined ? dto.description : costCenter.description,
          parentId: dto.parentId !== undefined ? dto.parentId : costCenter.parentId,
          managerId: dto.managerId !== undefined ? dto.managerId : costCenter.managerId,
          sortOrder: dto.sortOrder !== undefined ? dto.sortOrder : costCenter.sortOrder,
        },
        include: {
          parent: true,
          children: true,
        },
      });

      return updated;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to update cost center ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Deactivate a cost center (set isActive=false)
   * Check no entries exist
   */
  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const costCenter = await this.prisma.costCenter.findUnique({
        where: { id },
      });

      if (!costCenter || costCenter.tenantId !== tenantId) {
        throw new NotFoundException(`Cost center with ID ${id} not found`);
      }

      // Check if there are any cost entries
      const hasEntries = await this.prisma.costEntry.count({
        where: {
          costCenterId: id,
        },
      });

      if (hasEntries > 0) {
        throw new BadRequestException(
          `Cannot delete cost center with ${hasEntries} active entries`,
        );
      }

      await this.prisma.costCenter.update({
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
        `Failed to delete cost center ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Seed default USALI cost centers for a property
   */
  async seedDefaults(tenantId: string, propertyId: string): Promise<CostCenterWithRelations[]> {
    try {
      const defaults = [
        {
          name: 'Rooms',
          code: 'CC-ROOMS',
          type: CostCenterTypeEnum.ROOMS,
          description: 'Room operations and housekeeping',
          sortOrder: 1,
        },
        {
          name: 'Food & Beverage',
          code: 'CC-FB',
          type: CostCenterTypeEnum.FOOD_BEVERAGE,
          description: 'Food and beverage operations',
          sortOrder: 2,
        },
        {
          name: 'Admin & General',
          code: 'CC-ADMIN',
          type: CostCenterTypeEnum.ADMIN_GENERAL,
          description: 'Administrative and general expenses',
          sortOrder: 3,
        },
        {
          name: 'Sales & Marketing',
          code: 'CC-SM',
          type: CostCenterTypeEnum.SALES_MARKETING,
          description: 'Sales and marketing operations',
          sortOrder: 4,
        },
        {
          name: 'Maintenance',
          code: 'CC-MAINT',
          type: CostCenterTypeEnum.MAINTENANCE_DEPT,
          description: 'Maintenance and engineering department',
          sortOrder: 5,
        },
        {
          name: 'Energy',
          code: 'CC-ENERGY',
          type: CostCenterTypeEnum.ENERGY,
          description: 'Energy and utilities costs',
          sortOrder: 6,
        },
      ];

      const created = await Promise.all(
        defaults.map((defaultCc) =>
          this.prisma.costCenter.create({
            data: {
              tenantId,
              propertyId,
              name: defaultCc.name,
              code: defaultCc.code,
              type: defaultCc.type,
              description: defaultCc.description,
              sortOrder: defaultCc.sortOrder,
              isActive: true,
            },
          }),
        ),
      );

      this.logger.log(`Seeded ${created.length} default cost centers for property ${propertyId}`);

      return created;
    } catch (error) {
      this.logger.error(
        `Failed to seed default cost centers for property ${propertyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
