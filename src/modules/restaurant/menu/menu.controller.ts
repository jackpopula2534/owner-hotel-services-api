import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MenuService } from './menu.service';
import { CreateMenuCategoryDto } from './dto/create-menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('restaurant / menu')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@Controller({ path: 'restaurants/:restaurantId', version: '1' })
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // ─── Menu (Full) ──────────────────────────────────────────────────────────

  @Get('menu')
  @ApiOperation({ summary: 'Get full menu (categories + available items)' })
  @ApiParam({ name: 'restaurantId', description: 'Restaurant ID' })
  @ApiResponse({ status: 200, description: 'Full menu with categories and items' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async getFullMenu(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.getFullMenu(restaurantId, user.tenantId);
  }

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('menu-categories')
  @ApiOperation({ summary: 'Get all menu categories' })
  @ApiParam({ name: 'restaurantId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findAllCategories(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.findAllCategories(restaurantId, user.tenantId);
  }

  @Post('menu-categories')
  @ApiOperation({ summary: 'Create menu category' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async createCategory(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateMenuCategoryDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.createCategory(restaurantId, dto, user.tenantId, user?.id);
  }

  @Patch('menu-categories/reorder')
  @ApiOperation({ summary: 'Reorder menu categories' })
  @ApiParam({ name: 'restaurantId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async reorderCategories(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: ReorderCategoriesDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.reorderCategories(restaurantId, dto, user.tenantId);
  }

  @Patch('menu-categories/:categoryId')
  @ApiOperation({ summary: 'Update menu category' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'categoryId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async updateCategory(
    @Param('restaurantId') restaurantId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateMenuCategoryDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.updateCategory(restaurantId, categoryId, dto, user.tenantId, user?.id);
  }

  @Delete('menu-categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete menu category' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'categoryId' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager')
  async removeCategory(
    @Param('restaurantId') restaurantId: string,
    @Param('categoryId') categoryId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.removeCategory(restaurantId, categoryId, user.tenantId, user?.id);
  }

  // ─── Menu Items ───────────────────────────────────────────────────────────

  @Get('menu-items')
  @ApiOperation({ summary: 'Get all menu items (paginated)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'isAvailable', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findAllItems(
    @Param('restaurantId') restaurantId: string,
    @Query()
    query: {
      categoryId?: string;
      isAvailable?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.findAllItems(restaurantId, query, user.tenantId);
  }

  @Get('menu-items/:itemId')
  @ApiOperation({ summary: 'Get menu item by ID' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findOneItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.findOneItem(restaurantId, itemId, user.tenantId);
  }

  @Post('menu-items')
  @ApiOperation({ summary: 'Create menu item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 201, description: 'Menu item created' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async createItem(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.createItem(restaurantId, dto, user.tenantId, user?.id);
  }

  @Patch('menu-items/:itemId')
  @ApiOperation({ summary: 'Update menu item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async updateItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.updateItem(restaurantId, itemId, dto, user.tenantId, user?.id);
  }

  @Patch('menu-items/:itemId/availability')
  @ApiOperation({ summary: 'Toggle menu item availability' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async toggleAvailability(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body('isAvailable') isAvailable: boolean,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.toggleAvailability(
      restaurantId,
      itemId,
      isAvailable,
      user.tenantId,
      user?.id,
    );
  }

  @Delete('menu-items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete menu item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @ApiResponse({ status: 204, description: 'Menu item deleted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async removeItem(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.removeItem(restaurantId, itemId, user.tenantId, user?.id);
  }

  // ─── Recipe ───────────────────────────────────────────────────────────────

  @Get('menu-items/:itemId/recipe')
  @ApiOperation({ summary: 'Get recipe for a menu item (null if not defined)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @ApiResponse({ status: 200, description: 'Recipe with ingredients, or null' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async getRecipe(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.menuService.getRecipe(restaurantId, itemId, user.tenantId);
  }

  @Put('menu-items/:itemId/recipe')
  @ApiOperation({ summary: 'Create or update recipe for a menu item (upsert)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @ApiResponse({ status: 200, description: 'Recipe saved with ingredients' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async upsertRecipe(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body() dto: CreateRecipeDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.upsertRecipe(restaurantId, itemId, dto, user.tenantId, user?.id);
  }

  @Delete('menu-items/:itemId/recipe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete recipe for a menu item' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @ApiResponse({ status: 204, description: 'Recipe deleted' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async deleteRecipe(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.menuService.deleteRecipe(restaurantId, itemId, user.tenantId, user?.id);
  }
}
