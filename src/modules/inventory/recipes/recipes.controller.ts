import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { RecipesService } from './recipes.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Inventory - Recipes')
@ApiBearerAuth()
@Controller({ path: 'inventory/recipes', version: '1' })
@UseGuards(JwtAuthGuard, AddonGuard)
@RequireAddon('INVENTORY_MODULE')
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get()
  @ApiOperation({ summary: 'Get all recipes' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'List of recipes',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            menuItemId: '550e8400-e29b-41d4-a716-446655440001',
            menuItemName: 'Caesar Salad',
            servings: 4,
            ingredientCount: 3,
            createdAt: '2026-04-15T10:00:00Z',
            updatedAt: '2026-04-15T10:00:00Z',
          },
        ],
        meta: {
          page: 1,
          limit: 20,
          total: 10,
        },
      },
    },
  })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.recipesService.findAll(user?.tenantId, {
      page,
      limit,
      search,
    });

    return {
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
    };
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Get a recipe with full details and ingredients' })
  @ApiResponse({
    status: 200,
    description: 'Recipe detail',
    schema: {
      example: {
        success: true,
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          menuItemId: '550e8400-e29b-41d4-a716-446655440001',
          menuItemName: 'Caesar Salad',
          servings: 4,
          notes: 'Classic recipe',
          ingredientCount: 3,
          ingredients: [
            {
              itemId: '550e8400-e29b-41d4-a716-446655440002',
              itemName: 'Lettuce',
              quantity: 500,
              unit: 'grams',
              wastagePercent: 5,
            },
          ],
          createdAt: '2026-04-15T10:00:00Z',
          updatedAt: '2026-04-15T10:00:00Z',
        },
      },
    },
  })
  async findOne(@Param('id') id: string, @CurrentUser() user?: any): Promise<any> {
    const result = await this.recipesService.findOne(id, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Get('by-menu-item/:menuItemId')
  @ApiParam({ name: 'menuItemId', type: String })
  @ApiOperation({ summary: 'Get recipe by menu item ID' })
  @ApiResponse({
    status: 200,
    description: 'Recipe detail',
  })
  async findByMenuItem(
    @Param('menuItemId') menuItemId: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.recipesService.findByMenuItem(user?.tenantId, menuItemId);

    if (!result) {
      return {
        success: false,
        error: {
          code: 'RECIPE_NOT_FOUND',
          message: `Recipe not found for menu item ${menuItemId}`,
        },
      };
    }

    return {
      success: true,
      data: result,
    };
  }

  @Get(':id/cost')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Calculate recipe cost based on current ingredient costs',
  })
  @ApiResponse({
    status: 200,
    description: 'Recipe cost breakdown',
    schema: {
      example: {
        success: true,
        data: {
          ingredients: [
            {
              itemId: '550e8400-e29b-41d4-a716-446655440002',
              itemName: 'Lettuce',
              quantity: 500,
              unit: 'grams',
              wastagePercent: 5,
              unitCost: 0.5,
              lineCost: 250,
            },
          ],
          totalCost: 500,
          costPerServing: 125,
        },
      },
    },
  })
  async calculateCost(@Param('id') id: string, @CurrentUser() user?: any): Promise<any> {
    const result = await this.recipesService.calculateCost(id, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new recipe with ingredients' })
  @ApiResponse({
    status: 201,
    description: 'Recipe created',
  })
  async create(@Body() dto: CreateRecipeDto, @CurrentUser() user?: any): Promise<any> {
    const result = await this.recipesService.create(dto, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Update a recipe',
    description: 'Can update name, servings, notes, and ingredients (replaces all)',
  })
  @ApiResponse({
    status: 200,
    description: 'Recipe updated',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.recipesService.update(id, dto, user?.tenantId);

    return {
      success: true,
      data: result,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Delete a recipe',
    description: 'Cascades to delete all ingredients',
  })
  @ApiResponse({
    status: 204,
    description: 'Recipe deleted',
  })
  async remove(@Param('id') id: string, @CurrentUser() user?: any): Promise<void> {
    await this.recipesService.remove(id, user?.tenantId);
  }
}
