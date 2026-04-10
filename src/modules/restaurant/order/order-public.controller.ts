import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrderService } from './order.service';

/**
 * Public endpoints for QR-code ordering — no JWT required.
 * Guests scan a QR code at the table and place orders directly.
 * Rate-limited aggressively to prevent abuse.
 */
@ApiTags('restaurant / public QR ordering')
@Controller('public/restaurants')
export class OrderPublicController {
  constructor(private readonly orderService: OrderService) {}

  @Get(':restaurantId/tables/:tableId/menu')
  @Throttle({ default: { limit: 30, ttl: 60 } })   // 30 req/min per IP
  @ApiOperation({ summary: '[Public] Get menu for a table (QR scan)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @ApiResponse({ status: 200, description: 'Full menu grouped by category' })
  async getMenuForTable(
    @Param('restaurantId') restaurantId: string,
  ) {
    // Reuse menu service — import via service when needed; for now delegate
    return { restaurantId, message: 'Use GET /restaurants/:id/menu for full menu' };
  }

  @Post(':restaurantId/tables/:tableId/orders')
  @Throttle({ default: { limit: 10, ttl: 60 } })   // 10 new orders/min per IP
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Public] Create order via QR code (no auth)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @ApiBody({
    schema: {
      properties: {
        guestName: { type: 'string', example: 'John Doe' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              menuItemId: { type: 'string' },
              quantity: { type: 'number' },
              notes: { type: 'string' },
            },
          },
        },
      },
      required: ['items'],
    },
  })
  @ApiResponse({ status: 201, description: 'Order created — returns orderNumber for tracking' })
  async createQrOrder(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
    @Body() body: {
      guestName?: string;
      items: { menuItemId: string; quantity: number; notes?: string }[];
    },
  ) {
    return this.orderService.createPublicOrder(restaurantId, tableId, body);
  }

  @Get('orders/:orderNumber/status')
  @Throttle({ default: { limit: 60, ttl: 60 } })   // polling-friendly: 60 req/min
  @ApiOperation({ summary: '[Public] Track order status by order number' })
  @ApiParam({ name: 'orderNumber', example: 'ORD-20260410-0001' })
  @ApiResponse({ status: 200, description: 'Order status and items' })
  async getOrderStatus(
    @Param('orderNumber') orderNumber: string,
  ) {
    // tenantId is derived from the order itself via findByOrderNumber
    return this.orderService.findByOrderNumber(orderNumber, '');
  }
}
