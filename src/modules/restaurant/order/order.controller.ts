import {
  Controller,
  Get,
  Post,
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
  ApiBody,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { ProcessPaymentDto } from './dto/process-payment.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OrderStatus } from '@prisma/client';

@ApiTags('restaurant / orders')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'restaurant/:restaurantId/orders', version: '1' })
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'Get all orders (paginated, with filters)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'paymentStatus', required: false })
  @ApiQuery({ name: 'orderType', required: false })
  @ApiQuery({ name: 'tableId', required: false })
  @ApiQuery({ name: 'date', required: false, example: '2026-04-15' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findAll(
    @Param('restaurantId') restaurantId: string,
    @Query() query: {
      status?: string;
      paymentStatus?: string;
      orderType?: string;
      tableId?: string;
      date?: string;
      page?: number;
      limit?: number;
    },
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.findAll(restaurantId, query, user.tenantId);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter', 'staff')
  async findOne(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.findOne(restaurantId, orderId, user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create new order' })
  @ApiParam({ name: 'restaurantId' })
  @ApiResponse({ status: 201, description: 'Order created' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'staff')
  async create(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.create(restaurantId, dto, user.tenantId);
  }

  @Post(':orderId/items')
  @ApiOperation({ summary: 'Add item to order' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @ApiResponse({ status: 201, description: 'Item added' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'staff')
  async addItem(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() dto: AddOrderItemDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.addItem(restaurantId, orderId, dto, user.tenantId);
  }

  @Delete(':orderId/items/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item from order (only if not sent to kitchen)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @ApiParam({ name: 'itemId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter')
  async removeItem(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.removeItem(restaurantId, orderId, itemId, user.tenantId);
  }

  @Post(':orderId/send-to-kitchen')
  @ApiOperation({ summary: 'Send pending items to kitchen' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'staff')
  async sendToKitchen(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.sendToKitchen(restaurantId, orderId, user.tenantId);
  }

  @Patch(':orderId/status')
  @ApiOperation({ summary: 'Update order status' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @ApiBody({ schema: { properties: { status: { type: 'string', example: 'CONFIRMED' } } } })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'chef', 'waiter')
  async updateStatus(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body('status') status: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.updateStatus(restaurantId, orderId, status as OrderStatus, user.tenantId);
  }

  @Post(':orderId/payment')
  @ApiOperation({ summary: 'Process payment for order' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'accountant')
  async processPayment(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @Body() dto: ProcessPaymentDto,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.processPayment(restaurantId, orderId, dto, user.tenantId);
  }

  @Get(':orderId/receipt')
  @ApiOperation({ summary: 'Get order receipt' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'orderId' })
  @Roles('platform_admin', 'tenant_admin', 'admin', 'manager', 'waiter', 'accountant', 'staff')
  async getReceipt(
    @Param('restaurantId') restaurantId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: { tenantId: string },
  ) {
    return this.orderService.getReceipt(restaurantId, orderId, user.tenantId);
  }
}
