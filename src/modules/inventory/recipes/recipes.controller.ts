import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RecipeReadinessService } from './recipe-readiness.service';
import { RecipeLinkingService } from './recipe-linking.service';
import { RecipeRequisitionService } from './recipe-requisition.service';
import { MaterialRequisitionService } from './material-requisition.service';
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

  // CRUD ของสูตรชุดเก่า (inventory_recipes) ถูกถอดออก — สูตรจริงอยู่ที่เมนูร้านอาหาร
  // (menu_item_recipes) แก้ผ่าน /restaurants/:id/menu-items/:itemId/recipe
}
