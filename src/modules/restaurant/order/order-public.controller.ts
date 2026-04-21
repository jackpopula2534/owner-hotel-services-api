import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrderService } from './order.service';
import { TableService } from '../table/table.service';
import { GuestLookupDto } from './dto/guest-lookup.dto';

/**
 * Public endpoints for QR-code ordering — no JWT required.
 * Guests scan a QR code at the table and place orders directly.
 * Rate-limited aggressively to prevent abuse.
 */
@ApiTags('restaurant / public QR ordering')
@Controller('public/restaurants')
export class OrderPublicController {
  constructor(
    private readonly orderService: OrderService,
    private readonly tableService: TableService,
  ) {}

  @Get(':restaurantId/tables/:tableId/menu')
  @Throttle({ default: { limit: 30, ttl: 60 } }) // 30 req/min per IP
  @ApiOperation({ summary: '[Public] Get menu for a table (QR scan)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @ApiResponse({ status: 200, description: 'Full menu grouped by category with table info' })
  async getMenuForTable(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
  ) {
    const menu = await this.orderService.getPublicMenu(restaurantId);
    return menu;
  }

  @Get(':restaurantId/menu')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: '[Public] Get full menu for a restaurant (QR scan)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 200, description: 'Full menu grouped by category' })
  async getPublicMenu(@Param('restaurantId') restaurantId: string) {
    return this.orderService.getPublicMenu(restaurantId);
  }

  @Get(':restaurantId/tables/:tableId/qr-code')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @ApiOperation({ summary: '[Public] Generate QR code for table (no auth required)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @ApiResponse({
    status: 200,
    description: 'QR code image (base64 PNG) + URL',
    schema: {
      properties: {
        qrCode: { type: 'string', description: 'Base64-encoded PNG QR code' },
        url: { type: 'string', description: 'QR code target URL' },
      },
    },
  })
  async getPublicTableQrCode(
    @Param('restaurantId') restaurantId: string,
    @Param('tableId') tableId: string,
  ) {
    return this.orderService.generatePublicTableQrCode(restaurantId, tableId);
  }

  @Post(':restaurantId/guest-lookup')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Public] Lookup guest by name or nationalId (QR ordering)',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiBody({ type: GuestLookupDto })
  @ApiResponse({
    status: 200,
    description: 'Guest lookup result',
    schema: {
      oneOf: [
        {
          properties: {
            matched: { type: 'boolean', example: true },
            guest: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                isVip: { type: 'boolean' },
              },
            },
          },
        },
        {
          properties: {
            matched: { type: 'boolean', example: false },
          },
        },
      ],
    },
  })
  async lookupGuest(@Param('restaurantId') restaurantId: string, @Body() dto: GuestLookupDto) {
    return this.orderService.lookupGuest(restaurantId, dto.query);
  }

  @Post(':restaurantId/tables/:tableId/orders')
  @Throttle({ default: { limit: 10, ttl: 60 } }) // 10 new orders/min per IP
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Public] Create order via QR code (no auth)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'tableId' })
  @ApiBody({
    schema: {
      properties: {
        guestName: { type: 'string', example: 'John Doe' },
        guestId: { type: 'string', description: 'Optional: matched guest ID for 2% VIP discount' },
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
    @Body()
    body: {
      guestName?: string;
      guestId?: string;
      items: { menuItemId: string; quantity: number; notes?: string }[];
    },
  ) {
    return this.orderService.createPublicOrder(restaurantId, tableId, body);
  }

  @Get('orders/:orderNumber/status')
  @Throttle({ default: { limit: 60, ttl: 60 } }) // polling-friendly: 60 req/min
  @ApiOperation({ summary: '[Public] Track order status by order number' })
  @ApiParam({ name: 'orderNumber', example: 'ORD-20260410-0001' })
  @ApiResponse({ status: 200, description: 'Order status and items' })
  async getOrderStatus(@Param('orderNumber') orderNumber: string) {
    // tenantId is derived from the order itself via findByOrderNumber
    return this.orderService.findByOrderNumber(orderNumber, '');
  }
}
