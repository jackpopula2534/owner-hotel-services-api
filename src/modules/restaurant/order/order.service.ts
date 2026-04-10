import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';
import { CreateOrderDto, OrderTypeEnum } from './dto/create-order.dto';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { ProcessPaymentDto, PaymentMethodEnum } from './dto/process-payment.dto';
import { KitchenGateway } from '../kitchen/kitchen.gateway';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly kitchenGateway?: KitchenGateway,
  ) {}

  // ─── Orders ───────────────────────────────────────────────────────────────

  async findAll(
    restaurantId: string,
    query: {
      status?: string;
      paymentStatus?: string;
      orderType?: string;
      tableId?: string;
      date?: string;
      page?: number;
      limit?: number;
    },
    tenantId: string,
  ) {
    const { status, paymentStatus, orderType, tableId, date, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { restaurantId, tenantId };
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (orderType) where.orderType = orderType;
    if (tableId) where.tableId = tableId;
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      where.createdAt = { gte: start, lte: end };
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          table: { select: { id: true, tableNumber: true, zone: true } },
          items: {
            include: { menuItem: { select: { id: true, name: true, image: true } } },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(restaurantId: string, orderId: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, restaurantId, tenantId },
      include: {
        table: true,
        items: {
          include: {
            menuItem: { select: { id: true, name: true, image: true, preparationTime: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        kitchenOrders: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    return order;
  }

  async findByOrderNumber(orderNumber: string, tenantId: string) {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, tenantId },
      include: {
        table: { select: { id: true, tableNumber: true } },
        items: {
          include: { menuItem: { select: { id: true, name: true, image: true } } },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderNumber} not found`);
    }

    return order;
  }

  async create(restaurantId: string, dto: CreateOrderDto, tenantId: string) {
    // Validate restaurant
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant with ID ${restaurantId} not found`);
    }

    // Validate table if provided
    if (dto.tableId) {
      const table = await this.prisma.restaurantTable.findFirst({
        where: { id: dto.tableId, restaurantId, tenantId },
      });
      if (!table) {
        throw new NotFoundException(`Table ${dto.tableId} not found`);
      }
    }

    const orderNumber = await this.generateOrderNumber(tenantId);

    // Build initial items if provided
    let items: {
      menuItemId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      notes?: string;
      modifiers?: string;
      tenantId: string;
    }[] = [];

    if (dto.items && dto.items.length > 0) {
      const menuItems = await this.prisma.menuItem.findMany({
        where: {
          id: { in: dto.items.map((i) => i.menuItemId) },
          restaurantId,
          tenantId,
          isAvailable: true,
        },
      });

      items = dto.items.map((orderItem) => {
        const menuItem = menuItems.find((m) => m.id === orderItem.menuItemId);
        if (!menuItem) {
          throw new BadRequestException(
            `Menu item ${orderItem.menuItemId} not found or unavailable`,
          );
        }
        const unitPrice = Number(menuItem.price);
        return {
          menuItemId: orderItem.menuItemId,
          quantity: orderItem.quantity,
          unitPrice,
          totalPrice: unitPrice * orderItem.quantity,
          notes: orderItem.notes,
          modifiers: orderItem.modifiers ? JSON.stringify(orderItem.modifiers) : undefined,
          tenantId,
        };
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const taxRate = dto.taxRate ?? 7;
    const serviceRate = dto.serviceRate ?? 10;
    const taxAmount = subtotal * (taxRate / 100);
    const serviceCharge = subtotal * (serviceRate / 100);
    const total = subtotal + taxAmount + serviceCharge;

    const order = await this.prisma.order.create({
      data: {
        restaurantId,
        tenantId,
        orderNumber,
        orderType: (dto.orderType as OrderTypeEnum) ?? OrderTypeEnum.DINE_IN,
        tableId: dto.tableId,
        waiterId: dto.waiterId,
        guestName: dto.guestName,
        guestRoom: dto.guestRoom,
        partySize: dto.partySize,
        notes: dto.notes,
        taxRate,
        serviceRate,
        subtotal,
        taxAmount,
        serviceCharge,
        total,
        items: items.length > 0 ? { create: items } : undefined,
      },
      include: {
        table: { select: { id: true, tableNumber: true } },
        items: { include: { menuItem: { select: { id: true, name: true } } } },
      },
    });

    // Update table status if dine-in
    if (dto.tableId && dto.orderType !== OrderTypeEnum.DELIVERY) {
      await this.prisma.restaurantTable.update({
        where: { id: dto.tableId },
        data: { status: 'OCCUPIED' },
      });
    }

    return order;
  }

  async addItem(
    restaurantId: string,
    orderId: string,
    dto: AddOrderItemDto,
    tenantId: string,
  ) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(`Cannot add items to a ${order.status} order`);
    }

    const menuItem = await this.prisma.menuItem.findFirst({
      where: { id: dto.menuItemId, restaurantId, tenantId, isAvailable: true },
    });

    if (!menuItem) {
      throw new NotFoundException(`Menu item ${dto.menuItemId} not found or unavailable`);
    }

    const unitPrice = Number(menuItem.price);
    const totalPrice = unitPrice * dto.quantity;

    const newItem = await this.prisma.orderItem.create({
      data: {
        orderId,
        menuItemId: dto.menuItemId,
        quantity: dto.quantity,
        unitPrice,
        totalPrice,
        notes: dto.notes,
        modifiers: dto.modifiers ? JSON.stringify(dto.modifiers) : undefined,
        tenantId,
      },
      include: { menuItem: { select: { id: true, name: true } } },
    });

    await this.recalculateTotals(orderId, order);

    return newItem;
  }

  async removeItem(
    restaurantId: string,
    orderId: string,
    itemId: string,
    tenantId: string,
  ) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(`Cannot remove items from a ${order.status} order`);
    }

    const item = order.items?.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException(`Order item ${itemId} not found`);
    }

    if (item.sentToKitchen) {
      throw new BadRequestException('Cannot remove an item that has been sent to kitchen');
    }

    await this.prisma.orderItem.delete({ where: { id: itemId } });
    await this.recalculateTotals(orderId, order);
  }

  async sendToKitchen(restaurantId: string, orderId: string, tenantId: string) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
      throw new BadRequestException(`Cannot send ${order.status} order to kitchen`);
    }

    const pendingItems = order.items?.filter((i) => !i.sentToKitchen && i.status !== 'CANCELLED') ?? [];

    if (pendingItems.length === 0) {
      throw new BadRequestException('No new items to send to kitchen');
    }

    const now = new Date();

    const [, , kitchenOrder] = await this.prisma.$transaction([
      // Mark items as sent
      this.prisma.orderItem.updateMany({
        where: { id: { in: pendingItems.map((i) => i.id) } },
        data: { sentToKitchen: true, sentAt: now, status: 'SENT' },
      }),
      // Update order status
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'PREPARING', confirmedAt: order.confirmedAt ?? now },
      }),
      // Create kitchen order ticket
      this.prisma.kitchenOrder.create({
        data: { orderId, tenantId, status: 'SENT', priority: 'NORMAL' },
      }),
    ]);

    const updatedOrder = await this.findOne(restaurantId, orderId, tenantId);

    // Emit real-time event to kitchen display
    this.kitchenGateway?.emitNewOrder(tenantId, restaurantId, {
      kitchenOrderId: kitchenOrder.id,
      orderId,
      orderNumber: updatedOrder.orderNumber,
      tableNumber: updatedOrder.table?.tableNumber ?? null,
      items: pendingItems.map((i) => ({
        id: i.id,
        name: (i as any).menuItem?.name ?? i.menuItemId,
        quantity: i.quantity,
        notes: i.notes,
      })),
      priority: 'NORMAL',
      sentAt: now,
    });

    return updatedOrder;
  }

  async updateStatus(
    restaurantId: string,
    orderId: string,
    status: OrderStatus,
    tenantId: string,
  ) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    const validTransitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PREPARING', 'CANCELLED'],
      PREPARING: ['READY', 'CANCELLED'],
      READY: ['SERVED'],
      SERVED: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${status}`,
      );
    }

    const timestamps: Record<string, Date> = {};
    const now = new Date();
    if (status === 'CONFIRMED') timestamps.confirmedAt = now;
    if (status === 'COMPLETED') {
      timestamps.completedAt = now;
      // Set table to cleaning after order completed
      if (order.tableId) {
        await this.prisma.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'CLEANING' },
        });
      }
    }
    if (status === 'CANCELLED') {
      timestamps.cancelledAt = now;
      if (order.tableId) {
        await this.prisma.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status, ...timestamps },
      include: {
        table: { select: { id: true, tableNumber: true } },
        items: true,
      },
    });

    // Notify guest via WebSocket (e.g. QR order tracking)
    this.kitchenGateway?.emitOrderStatusToGuest(order.orderNumber, {
      orderNumber: order.orderNumber,
      status,
      updatedAt: new Date(),
    });

    return updatedOrder;
  }

  async processPayment(
    restaurantId: string,
    orderId: string,
    dto: ProcessPaymentDto,
    tenantId: string,
  ) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('Order is already paid');
    }

    if (['CANCELLED'].includes(order.status)) {
      throw new BadRequestException('Cannot process payment for a cancelled order');
    }

    if (dto.paymentMethod === PaymentMethodEnum.ROOM_CHARGE && !dto.guestRoom) {
      throw new BadRequestException('Room number is required for room charge payment');
    }

    const discount = dto.discount ?? 0;
    const total = Number(order.total) - discount;

    if (dto.paidAmount < total) {
      throw new BadRequestException(
        `Paid amount (${dto.paidAmount}) is less than order total (${total})`,
      );
    }

    const changeAmount = dto.paidAmount - total;

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PAID',
        paymentMethod: dto.paymentMethod,
        paidAmount: dto.paidAmount,
        changeAmount,
        discount,
        total,
        guestRoom: dto.guestRoom ?? order.guestRoom,
        status: order.status === 'SERVED' ? 'COMPLETED' : order.status,
        completedAt: new Date(),
      },
    });
  }

  async getReceipt(restaurantId: string, orderId: string, tenantId: string) {
    const order = await this.findOne(restaurantId, orderId, tenantId);
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });

    return {
      receiptNumber: `RCT-${order.orderNumber}`,
      restaurant: { name: restaurant?.name, location: restaurant?.location },
      order: {
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        table: order.table?.tableNumber,
        guestName: order.guestName,
        guestRoom: order.guestRoom,
        items: order.items?.map((item) => ({
          name: item.menuItem?.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          notes: item.notes,
        })),
        subtotal: order.subtotal,
        taxRate: order.taxRate,
        taxAmount: order.taxAmount,
        serviceRate: order.serviceRate,
        serviceCharge: order.serviceCharge,
        discount: order.discount,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paidAmount: order.paidAmount,
        changeAmount: order.changeAmount,
        paymentStatus: order.paymentStatus,
      },
      printedAt: new Date().toISOString(),
    };
  }

  // ─── Public QR Ordering ───────────────────────────────────────────────────

  async createPublicOrder(
    restaurantId: string,
    tableId: string,
    dto: {
      guestName?: string;
      items: { menuItemId: string; quantity: number; notes?: string }[];
    },
  ) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, restaurantId, isActive: true },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    // get tenantId from restaurant
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const tenantId = restaurant.tenantId ?? '';

    return this.create(restaurantId, {
      tableId,
      orderType: OrderTypeEnum.DINE_IN,
      guestName: dto.guestName,
      partySize: 1,
      items: dto.items,
    }, tenantId);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async recalculateTotals(
    orderId: string,
    currentOrder: { taxRate: unknown; serviceRate: unknown; discount: unknown },
  ) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId, status: { not: 'CANCELLED' } },
    });

    const subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice), 0);
    const taxRate = Number(currentOrder.taxRate);
    const serviceRate = Number(currentOrder.serviceRate);
    const taxAmount = subtotal * (taxRate / 100);
    const serviceCharge = subtotal * (serviceRate / 100);
    const discount = Number(currentOrder.discount);
    const total = subtotal + taxAmount + serviceCharge - discount;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { subtotal, taxAmount, serviceCharge, total },
    });
  }

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);

    const count = await this.prisma.order.count({
      where: {
        tenantId,
        createdAt: { gte: startOfDay },
      },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `ORD-${dateStr}-${seq}`;
  }
}
