import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

export interface CategoryWithChildren {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children?: CategoryWithChildren[];
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find all active categories for a tenant with tree structure (max 3 levels)
   */
  async findAll(tenantId: string): Promise<CategoryWithChildren[]> {
    try {
      const categories = await this.prisma.itemCategory.findMany({
        where: {
          tenantId,
          isActive: true,
          parentId: null, // Only root categories
        },
        include: {
          children: {
            where: { isActive: true },
            include: {
              children: {
                where: { isActive: true },
                include: {
                  children: {
                    where: { isActive: true },
                  },
                },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });

      return categories as CategoryWithChildren[];
    } catch (error) {
      this.logger.error(`Error finding categories: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Find a single category by ID with children and parent
   */
  async findOne(id: string, tenantId: string): Promise<any> {
    try {
      const category = await this.prisma.itemCategory.findUnique({
        where: { id },
        include: {
          parent: true,
          children: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      if (!category) {
        throw new NotFoundException(`Category with ID ${id} not found`);
      }

      if (category.tenantId !== tenantId) {
        throw new NotFoundException(`Category with ID ${id} not found`);
      }

      return category;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error finding category ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create a new category
   * Validate parentId exists if provided
   */
  async create(dto: CreateCategoryDto, tenantId: string): Promise<any> {
    try {
      // Check for duplicate code within tenant
      const existing = await this.prisma.itemCategory.findFirst({
        where: {
          tenantId,
          code: dto.code,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Category with code ${dto.code} already exists for this tenant`,
        );
      }

      // Validate parentId exists if provided
      if (dto.parentId) {
        const parent = await this.prisma.itemCategory.findUnique({
          where: { id: dto.parentId },
        });

        if (!parent || parent.tenantId !== tenantId) {
          throw new BadRequestException('Invalid parentId');
        }
      }

      const category = await this.prisma.itemCategory.create({
        data: {
          tenantId,
          name: dto.name,
          code: dto.code,
          description: dto.description || null,
          parentId: dto.parentId || null,
          sortOrder: dto.sortOrder || 0,
          isActive: dto.isActive !== false,
        },
        include: {
          parent: true,
          children: true,
        },
      });

      return category;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error creating category: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update a category
   * Prevent circular parent reference (parent cannot be self or descendant)
   */
  async update(id: string, dto: UpdateCategoryDto, tenantId: string): Promise<any> {
    try {
      const category = await this.findOne(id, tenantId);

      // Check for duplicate code if code is being changed
      if (dto.code && dto.code !== category.code) {
        const existing = await this.prisma.itemCategory.findFirst({
          where: {
            tenantId,
            code: dto.code,
            id: { not: id },
          },
        });

        if (existing) {
          throw new ConflictException(
            `Category with code ${dto.code} already exists for this tenant`,
          );
        }
      }

      // Prevent circular parent reference
      if (dto.parentId && dto.parentId !== category.parentId) {
        if (dto.parentId === id) {
          throw new BadRequestException('Category cannot be its own parent');
        }

        // Check if parent is a descendant of this category
        const isDescendant = await this.isDescendant(id, dto.parentId, tenantId);
        if (isDescendant) {
          throw new BadRequestException('Cannot set a descendant as parent (circular reference)');
        }

        // Validate parent exists
        const parent = await this.prisma.itemCategory.findUnique({
          where: { id: dto.parentId },
        });

        if (!parent || parent.tenantId !== tenantId) {
          throw new BadRequestException('Invalid parentId');
        }
      }

      const updated = await this.prisma.itemCategory.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.code && { code: dto.code }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.parentId !== undefined && { parentId: dto.parentId }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
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
      this.logger.error(`Error updating category ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Remove a category
   * Check that no items are assigned to this category
   */
  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const category = await this.findOne(id, tenantId);

      // Check if any items are assigned to this category
      const itemCount = await this.prisma.inventoryItem.count({
        where: {
          categoryId: id,
          deletedAt: null,
        },
      });

      if (itemCount > 0) {
        throw new BadRequestException(
          `Cannot delete category with ${itemCount} assigned items. Move items to another category first.`,
        );
      }

      // Check if category has children
      const childCount = await this.prisma.itemCategory.count({
        where: {
          parentId: id,
        },
      });

      if (childCount > 0) {
        throw new BadRequestException(
          `Cannot delete category with ${childCount} subcategories. Delete subcategories first.`,
        );
      }

      await this.prisma.itemCategory.delete({
        where: { id },
      });

      this.logger.log(`Category ${id} deleted`);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Error deleting category ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Check if a potential parent is a descendant of a category
   * Used to prevent circular references
   */
  private async isDescendant(
    categoryId: string,
    potentialParentId: string,
    tenantId: string,
  ): Promise<boolean> {
    const parent = await this.prisma.itemCategory.findUnique({
      where: { id: potentialParentId },
      include: { parent: true },
    });

    if (!parent) {
      return false;
    }

    if (parent.parentId === categoryId) {
      return true;
    }

    if (parent.parentId) {
      return this.isDescendant(categoryId, parent.parentId, tenantId);
    }

    return false;
  }
}
