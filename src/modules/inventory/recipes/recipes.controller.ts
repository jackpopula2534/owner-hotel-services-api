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
import { RecipeReadinessService } from './recipe-readiness.service';
import { RecipeLinkingService } from './recipe-linking.service';
import { RecipeRequisitionService } from './recipe-requisition.service';
import { MaterialRequisitionService } from './material-requisition.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
import { LinkIngredientsDto } from './dto/link-ingredients.dto';
import {
  CancelMaterialRequisitionDto,
  ListMaterialRequisitionsDto,
  PlanRecipeRequisitionDto,
  SubmitRecipeRequisitionDto,
} from './dto/recipe-requisition.dto';
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
  constructor(
    private readonly recipesService: RecipesService,
    private readonly readinessService: RecipeReadinessService,
    private readonly linkingService: RecipeLinkingService,
    private readonly requisitionService: RecipeRequisitionService,
    private readonly materialRequisitions: MaterialRequisitionService,
  ) {}

  @Post('link-ingredients')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Auto-link free-text recipe ingredients to inventory items',
    description:
      'Matches every unlinked (นอกคลัง) recipe ingredient to an inventory item by name; ' +
      'optionally creates missing items and a kitchen warehouse so stock tracking works ' +
      'in one click. Idempotent — re-running only touches ingredients still free-text.',
  })
  @ApiResponse({ status: 200, description: 'Linking summary' })
  async linkIngredients(
    @Body() dto: LinkIngredientsDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.linkingService.linkIngredients(user?.tenantId, {
      restaurantId: dto.restaurantId,
      createMissing: dto.createMissing,
    });
    return { success: true, data: result };
  }

  // Readiness is a KITCHEN feature (reads menuItemRecipe, not InventoryRecipe), so it is
  // gated by RESTAURANT_MODULE — overriding the controller-level INVENTORY_MODULE. This lets
  // a restaurant/kitchen tenant with NO inventory sub-system still view their recipes; the
  // service degrades to "unknown" plate counts (no kitchen warehouse → no stock data) instead
  // of a 403. When inventory IS present, stock-based plate counts light up automatically.
  @Get('readiness')
  @RequireAddon('RESTAURANT_MODULE')
  @ApiOperation({
    summary: 'Kitchen readiness — how many plates each menu can make from current stock',
    description:
      'Cross-references every menu-item recipe (defined in Menu → Recipe tab) with the ' +
      'kitchen warehouse stock. Returns plates makeable, the bottleneck ingredient, and ' +
      'low-stock flags. Read-only — recipes are edited on the menu, not here. ' +
      'Works standalone without the inventory module (plate counts show as unknown).',
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'restaurantId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Readiness list + summary counts' })
  async readiness(
    @Query('search') search?: string,
    @Query('restaurantId') restaurantId?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const result = await this.readinessService.getReadiness(user?.tenantId, {
      search,
      restaurantId,
    });

    return { success: true, data: result.menus, meta: { summary: result.summary } };
  }

  // Both requisition routes keep the controller-level INVENTORY_MODULE gate: unlike
  // readiness they write to the warehouse, so a tenant without inventory has nothing
  // to write to. The Integration Hub switch is checked again inside the service.
  @Post('requisition/plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compute a draft requisition from recipes',
    description:
      'Given menus and the plate counts the kitchen wants to cover, returns the ingredients ' +
      'to requisition: exact need with wastage, minus kitchen stock on hand, rounded up to ' +
      'whole units. Writes nothing — the user edits this draft, then POSTs /requisition. ' +
      'Requires the "restaurant-inventory-requisition" connection to be on.',
  })
  @ApiResponse({ status: 200, description: 'Draft requisition lines + warehouses' })
  async planRequisition(
    @Body() dto: PlanRecipeRequisitionDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const data = await this.requisitionService.plan(user?.tenantId, dto);
    return { success: true, data };
  }

  @Post('requisition')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Turn the edited draft into a requisition document',
    description:
      'action=issue applies the draft as real stock movements — a transfer into the kitchen ' +
      'warehouse, or a goods issue when the tenant keeps a single warehouse — and every line ' +
      'is stock-checked before the first movement is written, so a requisition never ' +
      'half-lands. action=reserve instead parks the document in WAITING_STOCK and can open a ' +
      'purchase requisition for the shortfall; a goods receipt into the source warehouse then ' +
      'flips it to READY and notifies the kitchen.',
  })
  @ApiResponse({ status: 201, description: 'Requisition number, status, and any linked PR' })
  async submitRequisition(
    @Body() dto: SubmitRecipeRequisitionDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const data = await this.materialRequisitions.create(user?.tenantId, user?.id, dto);
    return { success: true, data };
  }

  // Declared above @Get(':id') on purpose — Nest matches routes in declaration
  // order, and 'requisitions' would otherwise be read as a recipe id.
  @Get('requisitions')
  @ApiOperation({
    summary: 'Requisition documents — what is waiting for stock and what is ready to issue',
    description:
      'Defaults to the open ones (WAITING_STOCK + READY). Each line carries live source-warehouse ' +
      'stock, so the caller can tell a READY document from one still short.',
  })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'restaurantId', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Requisition documents with their lines' })
  async listRequisitions(
    @Query() query: ListMaterialRequisitionsDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const data = await this.materialRequisitions.list(user?.tenantId, query);
    return { success: true, data };
  }

  @Get('requisitions/:id')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'One requisition document — what the detail modal opens on',
    description:
      'Same shape as a list row, so a purchase requisition can deep-link straight to the ' +
      'requisition waiting on it without the caller paging through the list.',
  })
  @ApiResponse({ status: 200, description: 'Requisition document with its lines' })
  async getRequisition(@Param('id') id: string, @CurrentUser() user?: any): Promise<any> {
    const data = await this.materialRequisitions.findOne(user?.tenantId, id);
    return { success: true, data };
  }

  @Post('requisitions/:id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Issue a parked requisition now that the stock has arrived',
    description:
      'Re-checks the source warehouse at issue time — READY is a hint, never a promise, since ' +
      'anything could have drawn the same items down in between.',
  })
  @ApiResponse({ status: 200, description: 'Requisition issued' })
  async issueRequisition(@Param('id') id: string, @CurrentUser() user?: any): Promise<any> {
    const data = await this.materialRequisitions.issue(user?.tenantId, user?.id, id);
    return { success: true, data };
  }

  @Post('requisitions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Cancel a requisition that is still waiting or ready' })
  @ApiResponse({ status: 200, description: 'Requisition cancelled' })
  async cancelRequisition(
    @Param('id') id: string,
    @Body() dto: CancelMaterialRequisitionDto,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const data = await this.materialRequisitions.cancel(user?.tenantId, user?.id, id, dto);
    return { success: true, data };
  }

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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: any,
  ): Promise<any> {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const result = await this.recipesService.findAll(user?.tenantId, {
      page: pageNum,
      limit: limitNum,
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
