import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { normalizePagination } from '../../../common/utils/pagination.util';

interface RecipeIngredientDetail {
  itemId: string;
  itemName?: string;
  itemSku?: string;
  quantity: number;
  unit: string;
  wastagePercent?: number;
  notes?: string;
}

interface RecipeDetail {
  id: string;
  tenantId: string;
  menuItemId: string;
  menuItemName: string;
  servings: number;
  notes?: string;
  ingredientCount: number;
  ingredients?: RecipeIngredientDetail[];
  createdAt: Date;
  updatedAt: Date;
}

interface RecipeListItem {
  id: string;
  tenantId: string;
  menuItemId: string;
  menuItemName: string;
  servings: number;
  ingredientCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RecipeCostBreakdown {
  ingredients: Array<{
    itemId: string;
    itemName?: string;
    quantity: number;
    unit: string;
    wastagePercent?: number;
    unitCost?: number;
    lineCost?: number;
  }>;
  totalCost: number;
  costPerServing: number;
}

interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
}

@Injectable()
export class RecipesService {
  private readonly logger = new Logger(RecipesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get all recipes with pagination and optional search
   */
  async findAll(
    tenantId: string,
    query: PaginationQuery = {},
  ): Promise<{
    data: RecipeListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    const { page, limit, skip } = normalizePagination(query.page, query.limit);

    const where: any = { tenantId };

    if (query.search) {
      // mode: 'insensitive' is not supported by Prisma v5 + MySQL
      where.menuItemName = {
        contains: query.search,
      };
    }

    try {
      const [recipes, total] = await Promise.all([
        this.prisma.inventoryRecipe.findMany({
          where,
          select: {
            id: true,
            tenantId: true,
            menuItemId: true,
            menuItemName: true,
            servings: true,
            createdAt: true,
            updatedAt: true,
            ingredients: {
              select: { id: true },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.inventoryRecipe.count({ where }),
      ]);

      const data: RecipeListItem[] = recipes.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        menuItemId: r.menuItemId,
        menuItemName: r.menuItemName,
        servings: r.servings,
        ingredientCount: r.ingredients.length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      return { data, total, page, limit };
    } catch (error) {
      this.logger.error('Error finding recipes:', error);
      throw error;
    }
  }

  /**
   * Get a single recipe with full details including ingredients
   */
  async findOne(id: string, tenantId: string): Promise<RecipeDetail> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Recipe ID is required');
    }

    try {
      const recipe = await this.prisma.inventoryRecipe.findUnique({
        where: { id },
        include: {
          ingredients: {
            select: {
              itemId: true,
              quantity: true,
              unit: true,
              wastagePercent: true,
              notes: true,
            },
          },
        },
      });

      if (!recipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found`);
      }

      if (recipe.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      return {
        id: recipe.id,
        tenantId: recipe.tenantId,
        menuItemId: recipe.menuItemId,
        menuItemName: recipe.menuItemName,
        servings: recipe.servings,
        notes: recipe.notes || undefined,
        ingredientCount: recipe.ingredients.length,
        ingredients: recipe.ingredients.map((ing) => ({
          itemId: ing.itemId,
          quantity: Number(ing.quantity),
          unit: ing.unit,
          wastagePercent: ing.wastagePercent != null ? Number(ing.wastagePercent) : undefined,
          notes: ing.notes || undefined,
        })),
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Error finding recipe ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get recipe by menu item ID
   */
  async findByMenuItem(tenantId: string, menuItemId: string): Promise<RecipeDetail | null> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!menuItemId) {
      throw new BadRequestException('Menu item ID is required');
    }

    try {
      const recipe = await this.prisma.inventoryRecipe.findFirst({
        where: { tenantId, menuItemId },
        include: {
          ingredients: {
            select: {
              itemId: true,
              quantity: true,
              unit: true,
              wastagePercent: true,
              notes: true,
            },
          },
        },
      });

      if (!recipe) {
        return null;
      }

      return {
        id: recipe.id,
        tenantId: recipe.tenantId,
        menuItemId: recipe.menuItemId,
        menuItemName: recipe.menuItemName,
        servings: recipe.servings,
        notes: recipe.notes || undefined,
        ingredientCount: recipe.ingredients.length,
        ingredients: recipe.ingredients.map((ing) => ({
          itemId: ing.itemId,
          quantity: Number(ing.quantity),
          unit: ing.unit,
          wastagePercent: ing.wastagePercent != null ? Number(ing.wastagePercent) : undefined,
          notes: ing.notes || undefined,
        })),
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Error finding recipe for menu item ${menuItemId}:`, error);
      throw error;
    }
  }

  /**
   * Create a new recipe with ingredients
   */
  async create(dto: CreateRecipeDto, tenantId: string): Promise<RecipeDetail> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!dto.ingredients || dto.ingredients.length === 0) {
      throw new BadRequestException('At least one ingredient is required');
    }

    try {
      // Check if recipe already exists for this menu item
      const existing = await this.prisma.inventoryRecipe.findFirst({
        where: { tenantId, menuItemId: dto.menuItemId },
      });

      if (existing) {
        throw new ConflictException(`Recipe already exists for menu item ${dto.menuItemId}`);
      }

      const recipe = await this.prisma.$transaction(async (tx) => {
        const newRecipe = await tx.inventoryRecipe.create({
          data: {
            tenantId,
            menuItemId: dto.menuItemId,
            menuItemName: dto.menuItemName,
            servings: dto.servings || 1,
            notes: dto.notes || null,
          },
        });

        // Create ingredients
        await tx.inventoryRecipeIngredient.createMany({
          data: dto.ingredients.map((ing) => ({
            recipeId: newRecipe.id,
            itemId: ing.itemId,
            quantity: ing.quantity,
            unit: ing.unit,
            wastagePercent: ing.wastagePercent || null,
            notes: ing.notes || null,
          })),
        });

        return newRecipe;
      });

      return {
        id: recipe.id,
        tenantId: recipe.tenantId,
        menuItemId: recipe.menuItemId,
        menuItemName: recipe.menuItemName,
        servings: recipe.servings,
        notes: recipe.notes || undefined,
        ingredientCount: dto.ingredients.length,
        ingredients: dto.ingredients.map((ing) => ({
          itemId: ing.itemId,
          quantity: ing.quantity,
          unit: ing.unit,
          wastagePercent: ing.wastagePercent || undefined,
          notes: ing.notes || undefined,
        })),
        createdAt: recipe.createdAt,
        updatedAt: recipe.updatedAt,
      };
    } catch (error) {
      this.logger.error('Error creating recipe:', error);
      throw error;
    }
  }

  /**
   * Update a recipe and its ingredients
   */
  async update(id: string, dto: UpdateRecipeDto, tenantId: string): Promise<RecipeDetail> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Recipe ID is required');
    }

    try {
      const recipe = await this.prisma.inventoryRecipe.findUnique({
        where: { id },
      });

      if (!recipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found`);
      }

      if (recipe.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        // Update recipe fields
        const updatedRecipe = await tx.inventoryRecipe.update({
          where: { id },
          data: {
            menuItemName: dto.menuItemName || recipe.menuItemName,
            servings: dto.servings || recipe.servings,
            notes: dto.notes !== undefined ? dto.notes : recipe.notes,
          },
        });

        // If ingredients provided, replace them
        if (dto.ingredients) {
          await tx.inventoryRecipeIngredient.deleteMany({
            where: { recipeId: id },
          });

          await tx.inventoryRecipeIngredient.createMany({
            data: dto.ingredients.map((ing) => ({
              recipeId: id,
              itemId: ing.itemId,
              quantity: ing.quantity,
              unit: ing.unit,
              wastagePercent: ing.wastagePercent || null,
              notes: ing.notes || null,
            })),
          });
        }

        // Fetch updated recipe with ingredients
        const recipeWithIngredients = await tx.inventoryRecipe.findUnique({
          where: { id },
          include: {
            ingredients: {
              select: {
                itemId: true,
                quantity: true,
                unit: true,
                wastagePercent: true,
                notes: true,
              },
            },
          },
        });

        return recipeWithIngredients;
      });

      return {
        id: updated.id,
        tenantId: updated.tenantId,
        menuItemId: updated.menuItemId,
        menuItemName: updated.menuItemName,
        servings: updated.servings,
        notes: updated.notes || undefined,
        ingredientCount: updated.ingredients.length,
        ingredients: updated.ingredients.map((ing) => ({
          itemId: ing.itemId,
          quantity: Number(ing.quantity),
          unit: ing.unit,
          wastagePercent: ing.wastagePercent != null ? Number(ing.wastagePercent) : undefined,
          notes: ing.notes || undefined,
        })),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    } catch (error) {
      this.logger.error(`Error updating recipe ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a recipe and cascade delete ingredients
   */
  async remove(id: string, tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Recipe ID is required');
    }

    try {
      const recipe = await this.prisma.inventoryRecipe.findUnique({
        where: { id },
      });

      if (!recipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found`);
      }

      if (recipe.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      await this.prisma.$transaction(async (tx) => {
        // Delete ingredients first
        await tx.inventoryRecipeIngredient.deleteMany({
          where: { recipeId: id },
        });

        // Delete recipe
        await tx.inventoryRecipe.delete({
          where: { id },
        });
      });
    } catch (error) {
      this.logger.error(`Error deleting recipe ${id}:`, error);
      throw error;
    }
  }

  /**
   * Calculate recipe cost based on current average cost in inventory
   * This is a helper method that would integrate with the inventory module
   */
  async calculateCost(id: string, tenantId: string): Promise<RecipeCostBreakdown> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (!id) {
      throw new BadRequestException('Recipe ID is required');
    }

    try {
      const recipe = await this.prisma.inventoryRecipe.findUnique({
        where: { id },
        include: {
          ingredients: {
            select: {
              itemId: true,
              quantity: true,
              unit: true,
              wastagePercent: true,
            },
          },
        },
      });

      if (!recipe) {
        throw new NotFoundException(`Recipe with ID ${id} not found`);
      }

      if (recipe.tenantId !== tenantId) {
        throw new BadRequestException('Unauthorized');
      }

      // Calculate total cost
      // Note: This is a placeholder implementation
      // In production, you would fetch actual costs from the inventory module
      let totalCost = 0;
      const ingredients = recipe.ingredients.map((ing) => {
        // Placeholder: assuming cost calculation would come from inventory service
        // Example: fetch item by ID, get unitCost, multiply by quantity
        const wastagePercent = ing.wastagePercent != null ? Number(ing.wastagePercent) : 0;
        const quantity = Number(ing.quantity);
        const wastageMultiplier = 1 + wastagePercent / 100;
        const lineCost = quantity * wastageMultiplier; // This would be multiplied by unitCost

        totalCost += lineCost;

        return {
          itemId: ing.itemId,
          quantity,
          unit: ing.unit,
          wastagePercent: ing.wastagePercent != null ? Number(ing.wastagePercent) : undefined,
          lineCost, // Placeholder
        };
      });

      const costPerServing = recipe.servings > 0 ? totalCost / recipe.servings : totalCost;

      return {
        ingredients,
        totalCost,
        costPerServing,
      };
    } catch (error) {
      this.logger.error(`Error calculating cost for recipe ${id}:`, error);
      throw error;
    }
  }
}
