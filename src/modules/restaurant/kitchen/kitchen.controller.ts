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
import { OrderItemStatus, KitchenPriority } from '@prisma/client';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AddonGuard } from '../../../common/guards/addon.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireAddon } from '../../../common/decorators/require-addon.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('restaurant / kitchen')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, AddonGuard)
@RequireAddon('RESTAURANT_MODULE')
@Controller({ path: 'restaurants/:restaurantId/kitchen', version: '1' })
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

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
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'staff')
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
