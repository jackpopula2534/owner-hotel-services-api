import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { KitchenService } from './kitchen.service';
import { RecipeReadinessService } from '../../inventory/recipes/recipe-readiness.service';
import { ServeItemsDto } from './dto/serve-items.dto';
import { KitchenHistoryQueryDto, RecallBillDto } from './dto/recall-bill.dto';
import { OrderItemStatus, KitchenPriority } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AllowSystems } from '../../../common/decorators/allow-systems.decorator';

@ApiTags('restaurant / kitchen')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@AllowSystems('pos')
@Controller({ path: 'restaurants/:restaurantId/kitchen', version: '1' })
export class KitchenController {
  constructor(
    private readonly kitchenService: KitchenService,
    private readonly readinessService: RecipeReadinessService,
  ) {}

  @Get('orders')
  @ApiOperation({ summary: 'Get active kitchen orders queue (KDS)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 200, description: 'Active kitchen orders sorted by priority and time' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff')
  async getActiveOrders(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.kitchenService.getActiveOrders(restaurantId, user.tenantId);
  }

  @Get('menu-items/:menuItemId/readiness')
  @ApiOperation({
    summary: 'How many plates of one dish the kitchen stock still covers, per ingredient (recipe drawer)',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'menuItemId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff', 'bartender')
  async readiness(
    @Param('restaurantId') restaurantId: string,
    @Param('menuItemId') menuItemId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    const { menus } = await this.readinessService.getReadiness(user.tenantId, { restaurantId, menuItemId });
    return menus[0] ?? null;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get kitchen stats (avg prep time, queue size, completed today)' })
  @ApiParam({ name: 'restaurantId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async getStats(
    @Param('restaurantId') restaurantId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.kitchenService.getStats(restaurantId, user.tenantId);
  }

  @Patch('orders/:kitchenOrderId/start')
  @ApiOperation({ summary: 'Start preparing kitchen order' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'kitchenOrderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff')
  async startOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('kitchenOrderId') kitchenOrderId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.startOrder(restaurantId, kitchenOrderId, user.tenantId, user?.id);
  }

  @Patch('orders/:kitchenOrderId/complete')
  @ApiOperation({ summary: 'Mark kitchen order as ready (all items prepared)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'kitchenOrderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff')
  async completeOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('kitchenOrderId') kitchenOrderId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.completeOrder(restaurantId, kitchenOrderId, user.tenantId, user?.id);
  }

  @Patch('items/:itemId/status')
  @ApiOperation({ summary: 'Update individual order item status in kitchen' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'itemId' })
  @ApiBody({
    schema: {
      properties: {
        status: {
          type: 'string',
          enum: ['PREPARING', 'READY', 'SERVED', 'CANCELLED'],
          example: 'READY',
        },
      },
    },
  })
  @Roles(
    'platform_admin',
    'tenant_admin',
    'admin',
    'manager',
    'chef',
    'staff',
    'cashier',
    'bartender',
  )
  async updateItemStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body('status') status: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.updateItemStatus(
      restaurantId,
      itemId,
      status as OrderItemStatus,
      user.tenantId,
      user?.id,
    );
  }

  @Patch('bills/:orderId/accept')
  @ApiOperation({ summary: 'Accept a new round on the kitchen board (opens its tickets, items untouched)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff', 'bartender')
  async acceptBill(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.acceptBill(restaurantId, orderId, user.tenantId, user?.id);
  }

  @Patch('bills/:orderId/serve')
  @ApiOperation({ summary: 'Serve ready items of a bill (all READY items, or only itemIds)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff', 'waiter', 'cashier', 'bartender')
  async serveItems(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ServeItemsDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.serveItems(restaurantId, orderId, dto.itemIds, user.tenantId, user?.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Bills fully served since `since` (default today) — the kitchen history tab' })
  @ApiParam({ name: 'restaurantId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff', 'bartender')
  async history(
    @Param('restaurantId') restaurantId: string,
    @Query() query: KitchenHistoryQueryDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.kitchenService.getHistory(restaurantId, user.tenantId, query.since ? new Date(query.since) : undefined);
  }

  @Patch('bills/:orderId/recall')
  @ApiOperation({ summary: 'Bring served items of a bill back to the kitchen (remake, wrong dish, served by mistake)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff', 'bartender')
  async recallBill(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() dto: RecallBillDto,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.recallBill(restaurantId, orderId, dto, user.tenantId, user?.id);
  }

  @Patch('orders/:kitchenOrderId/priority')
  @ApiOperation({ summary: 'Set kitchen order priority' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'kitchenOrderId' })
  @ApiBody({
    schema: {
      properties: {
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'RUSH'], example: 'RUSH' },
      },
    },
  })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef')
  async setPriority(
    @Param('restaurantId') restaurantId: string,
    @Param('kitchenOrderId') kitchenOrderId: string,
    @Body('priority') priority: string,
    @CurrentUser() user: { tenantId: string; id?: string },
  ) {
    return this.kitchenService.setPriority(
      restaurantId,
      kitchenOrderId,
      priority as KitchenPriority,
      user.tenantId,
      user?.id,
    );
  }
}
