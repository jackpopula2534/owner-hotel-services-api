import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderStatus, Prisma } from '@prisma/client';
import { CreateOrderDto, OrderTypeEnum } from './dto/create-order.dto';
import { AddOrderItemDto } from './dto/add-order-item.dto';
import { ProcessPaymentDto, PaymentMethodEnum } from './dto/process-payment.dto';
import { MenuService } from '../menu/menu.service';
import { KitchenGateway } from '../kitchen/kitchen.gateway';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import {
  INVENTORY_EVENTS,
  RestaurantOrderCompletedEvent,
} from '../../inventory/events/inventory.events';
import { calculateOrderTotals, resolveChargeRates } from './order-totals.util';

/** `document_sequences.docType` for restaurant bill numbers. */
const ORDER_DOC_TYPE = 'ORD';

/** Standing discount for a bill charged by an in-house hotel guest. */
const GUEST_DISCOUNT_RATE = 0.02;

/** How many times to re-draw a bill number before giving up on a collision. */
const ORDER_NUMBER_ATTEMPTS = 5;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * What a bill exposes about the booking it belongs to. Enough for the POS to name
 * the party and jump back to the booking, and nothing more — a bill is not the
 * place to hand out a guest's e-mail address.
 */
const RESERVATION_LINK_SELECT = {
  id: true,
  guestName: true,
  guestPhone: true,
  partySize: true,
  status: true,
  reservationDate: true,
  startTime: true,
  seatedAt: true,
} as const;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly menuService: MenuService,
    private readonly auditLogService: AuditLogService,
    @Optional() private readonly kitchenGateway?: KitchenGateway,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ─── Booked Rooms (for Room Service lookup) ────────────────────────────

  async getBookedRooms(
    restaurantId: string,
    tenantId: string,
    search?: string,
  ): Promise<{ roomNumber: string; guestName: string; bookingId: string; status: string }[]> {
    // Verify restaurant belongs to tenant
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, tenantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Find bookings that are checked_in or confirmed for today
    const bookings = await this.prisma.booking.findMany({
      where: {
        tenantId,
        propertyId: restaurant.propertyId,
        status: { in: ['checked_in', 'confirmed'] },
        OR: [
          // Currently checked in (checkIn <= today < checkOut)
          {
            checkIn: { lte: endOfDay },
            checkOut: { gte: startOfDay },
          },
          // Scheduled for today
          {
            scheduledCheckIn: { lte: endOfDay },
            scheduledCheckOut: { gte: startOfDay },
          },
        ],
      },
      include: {
        room: { select: { number: true } },
        guest: { select: { firstName: true, lastName: true } },
      },
      orderBy: { room: { number: 'asc' } },
    });

    const results = bookings
      .filter((b) => b.room?.number)
      .map((b) => ({
        roomNumber: b.room!.number,
        guestName:
          [b.guest?.firstName || b.guestFirstName, b.guest?.lastName || b.guestLastName]
            .filter(Boolean)
            .join(' ') || 'ไม่ระบุชื่อ',
        bookingId: b.id,
        status: b.status,
      }));

    // Filter by search term if provided
    if (search) {
      const term = search.toLowerCase();
      return results.filter(
        (r) =>
          r.roomNumber.toLowerCase().includes(term) || r.guestName.toLowerCase().includes(term),
      );
    }

    return results;
  }

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
          // The list has to be able to say "this bill is ปิยะ's booking" without a
          // second round-trip per row.
          reservation: { select: RESERVATION_LINK_SELECT },
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
        reservation: { select: RESERVATION_LINK_SELECT },
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

  async create(restaurantId: string, dto: CreateOrderDto, tenantId: string, userId?: string) {
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

    const reservation = await this.resolveReservation(restaurantId, dto, tenantId);

    // The booking already knows who the party is — a bill opened for it must not
    // ask the floor to type that in again. Anything the caller did send wins, so
    // "order for a friend joining the table" is still possible.
    const guestName = dto.guestName ?? reservation?.guestName ?? undefined;
    const partySize = dto.partySize ?? reservation?.partySize ?? undefined;

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
    // The outlet's own policy decides what this bill charges; the rates are then
    // snapshotted onto the order so editing the policy never rewrites old bills.
    const { taxRate, serviceRate } = resolveChargeRates(restaurant, {
      taxRate: dto.taxRate,
      serviceRate: dto.serviceRate,
    });
    const { taxAmount, serviceCharge, total } = calculateOrderTotals({
      subtotal,
      taxRate,
      serviceRate,
    });

    const order = await this.createWithFreshOrderNumber(tenantId, (orderNumber) => ({
      data: {
        restaurantId,
        tenantId,
        orderNumber,
        orderType: (dto.orderType as OrderTypeEnum) ?? OrderTypeEnum.DINE_IN,
        tableId: dto.tableId,
        reservationId: reservation?.id ?? null,
        waiterId: dto.waiterId,
        guestName,
        guestRoom: dto.guestRoom,
        partySize,
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
        reservation: { select: RESERVATION_LINK_SELECT },
      },
    }));

    // Update table status if dine-in
    if (dto.tableId && dto.orderType !== OrderTypeEnum.DELIVERY) {
      await this.prisma.restaurantTable.update({
        where: { id: dto.tableId },
        data: { status: 'OCCUPIED' },
      });
    }

    this.auditLogService.logOrderCreate(order, userId, tenantId);
    return order;
  }

  async addItem(restaurantId: string, orderId: string, dto: AddOrderItemDto, tenantId: string) {
    const order = await this.findOne(restaurantId, orderId, tenantId);

    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(`Cannot add items to a ${order.status} order`);
    }

    // A settled bill has been rung up and handed over. Another round on it would
    // quietly reopen a balance on a receipt the guest already holds — that round
    // belongs on a new bill. PARTIAL is still open, so it is left alone.
    if (['PAID', 'REFUNDED'].includes(order.paymentStatus)) {
      throw new BadRequestException(
        `Cannot add items to a ${order.paymentStatus.toLowerCase()} order — open a new bill`,
      );
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

  async removeItem(restaurantId: string, orderId: string, itemId: string, tenantId: string) {
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

    // A second round of food goes onto the bill that is already open, so an order
    // that is PREPARING or READY must still accept a new ticket. Only a closed
    // bill has nothing left to cook.
    if (['COMPLETED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(`Cannot send ${order.status} order to kitchen`);
    }

    const pendingItems =
      order.items?.filter((i) => !i.sentToKitchen && i.status !== 'CANCELLED') ?? [];

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
    userId?: string,
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
      throw new BadRequestException(`Cannot transition order from ${order.status} to ${status}`);
    }

    const timestamps: Record<string, Date> = {};
    const now = new Date();
    if (status === 'CONFIRMED') timestamps.confirmedAt = now;
    if (status === 'COMPLETED') {
      timestamps.completedAt = now;
      await this.closeOutTable(order, 'CLEANING');
    }
    if (status === 'CANCELLED') {
      timestamps.cancelledAt = now;
      await this.closeOutTable(order, 'AVAILABLE');
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status, ...timestamps },
      include: {
        table: { select: { id: true, tableNumber: true } },
        items: true,
      },
    });

    this.auditLogService.logOrderUpdate(
      orderId,
      { status: order.status },
      { status },
      userId,
      tenantId,
    );

    // Notify guest via WebSocket (e.g. QR order tracking)
    this.kitchenGateway?.emitOrderStatusToGuest(order.orderNumber, {
      orderNumber: order.orderNumber,
      status,
      updatedAt: new Date(),
    });

    // When an order is completed, tell the inventory module to deduct recipe
    // ingredients from the kitchen warehouse. The listener is gated by the
    // INVENTORY_MODULE add-on and only touches stock-linked ingredients, so
    // tenants without inventory (or without linked recipes) are unaffected.
    if (status === 'COMPLETED') {
      await this.emitOrderCompleted(updatedOrder, restaurantId, tenantId, userId);
    }

    return updatedOrder;
  }

  /**
   * Emit `restaurant.order.completed` for the inventory listener to auto-deduct
   * ingredients. Never throws — a failure here must not roll back the completed
   * order (the deduction listener is best-effort and idempotency-safe).
   */
  private async emitOrderCompleted(
    order: { id: string; orderNumber: string; items?: { menuItemId: string; quantity: number }[] },
    restaurantId: string,
    tenantId: string,
    userId?: string,
  ): Promise<void> {
    if (!this.eventEmitter) return;
    try {
      const items = (order.items ?? [])
        .filter((i) => i.menuItemId && i.quantity > 0)
        .map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
      if (items.length === 0) return;

      // The listener resolves the kitchen warehouse by propertyId, which lives
      // on the restaurant (orders don't carry it directly).
      const restaurant = await this.prisma.restaurant.findFirst({
        where: { id: restaurantId, tenantId },
        select: { propertyId: true },
      });
      if (!restaurant?.propertyId) return;

      const payload: RestaurantOrderCompletedEvent = {
        orderId: order.id,
        tenantId,
        restaurantId,
        propertyId: restaurant.propertyId,
        items,
        completedBy: userId ?? 'system',
      };
      this.eventEmitter.emit(INVENTORY_EVENTS.RESTAURANT_ORDER_COMPLETED, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit order-completed event for order ${order.id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async processPayment(
    restaurantId: string,
    orderId: string,
    dto: ProcessPaymentDto,
    tenantId: string,
    userId?: string,
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

    // ส่วนลดตอนรับชำระเป็นส่วนลด "เพิ่มเติม" จากที่บิลมีอยู่แล้ว
    // (เช่น ส่วนลดลูกค้าประจำ 2% ที่ applyLoyaltyDiscount หักไปแล้ว)
    // ถ้าเขียนทับด้วย dto.discount ตรง ๆ ยอดส่วนลดเดิมจะหายไปทั้งที่ total ยังหักอยู่
    // → ใบเสร็จกระทบยอดไม่ตรงแบบเงียบ ๆ
    const extraDiscount = dto.discount ?? 0;
    // Prisma Decimal มาเป็น float ตอน Number() — ไม่ปัดจะได้ 157.60000000000002 ลงคอลัมน์เงิน
    const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const discount = round2(Number(order.discount ?? 0) + extraDiscount);
    const total = round2(Number(order.total) - extraDiscount);

    if (total < 0) {
      throw new BadRequestException(
        `Discount (${extraDiscount}) is greater than the order total (${Number(order.total)})`,
      );
    }

    if (dto.paidAmount < total) {
      throw new BadRequestException(
        `Paid amount (${dto.paidAmount}) is less than order total (${total})`,
      );
    }

    const changeAmount = round2(dto.paidAmount - total);
    const becomesCompleted = order.status === 'SERVED';

    const updatedOrderPayment = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PAID',
        paymentMethod: dto.paymentMethod,
        paidAmount: dto.paidAmount,
        changeAmount,
        discount,
        total,
        guestRoom: dto.guestRoom ?? order.guestRoom,
        status: becomesCompleted ? 'COMPLETED' : order.status,
        completedAt: new Date(),
      },
    });

    // Paying closes the bill without going through updateStatus, so the floor
    // has to be handed back here too — otherwise the table stays OCCUPIED forever.
    if (becomesCompleted) {
      await this.closeOutTable(order, 'CLEANING');
    }

    this.auditLogService.logOrderUpdate(
      orderId,
      { paymentStatus: order.paymentStatus },
      { paymentStatus: 'PAID' },
      userId,
      tenantId,
    );
    return updatedOrderPayment;
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

  async generatePublicTableQrCode(restaurantId: string, tableId: string) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, restaurantId, isActive: true },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:9010';
    const qrUrl = `${frontendUrl}/restaurant/order/${tableId}?restaurantId=${restaurantId}`;

    try {
      const qrCodeDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 300,
        margin: 1,
      });

      return {
        qrCode: qrCodeDataUrl,
        url: qrUrl,
      };
    } catch (error) {
      this.logger.error(`Failed to generate QR code for table ${tableId}`, error);
      throw new BadRequestException('Failed to generate QR code');
    }
  }

  async lookupGuest(
    restaurantId: string,
    query: string,
  ): Promise<{
    matched: boolean;
    guest?: { id: string; firstName: string; lastName: string; isVip: boolean };
  }> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      throw new BadRequestException('Guest lookup requires at least 2 characters');
    }

    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const tenantId = restaurant.tenantId ?? '';

    const guest = await this.prisma.guest.findFirst({
      where: {
        tenantId,
        OR: [
          { firstName: { contains: normalizedQuery } },
          { lastName: { contains: normalizedQuery } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isVip: true,
      },
    });

    if (!guest) {
      return { matched: false };
    }

    return {
      matched: true,
      guest,
    };
  }

  async getPublicMenu(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
      select: { id: true, name: true, tenantId: true },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const tenantId = restaurant.tenantId ?? '';

    const categories = await this.prisma.menuCategory.findMany({
      where: { restaurantId, tenantId, isActive: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        items: {
          where: { isAvailable: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    return {
      restaurant: { id: restaurant.id, name: restaurant.name },
      categories,
    };
  }

  async createPublicOrder(
    restaurantId: string,
    tableId: string,
    dto: {
      guestName?: string;
      guestId?: string;
      items: { menuItemId: string; quantity: number; notes?: string }[];
    },
  ) {
    const table = await this.prisma.restaurantTable.findFirst({
      where: { id: tableId, restaurantId, isActive: true },
    });

    if (!table) {
      throw new NotFoundException('Table not found');
    }

    const restaurant = await this.prisma.restaurant.findFirst({
      where: { id: restaurantId },
    });

    if (!restaurant) throw new NotFoundException('Restaurant not found');

    const tenantId = restaurant.tenantId ?? '';

    let guestName = dto.guestName;
    let guestIdForOrder: string | undefined;

    if (dto.guestId) {
      const guest = await this.prisma.guest.findFirst({
        where: { id: dto.guestId, tenantId },
      });

      if (!guest) {
        throw new NotFoundException(`Guest with ID ${dto.guestId} not found`);
      }

      guestName = `${guest.firstName} ${guest.lastName}`;
      guestIdForOrder = guest.id;
    }

    const order = await this.create(
      restaurantId,
      {
        tableId,
        orderType: OrderTypeEnum.DINE_IN,
        guestName,
        partySize: 1,
        items: dto.items,
      },
      tenantId,
    );

    if (guestIdForOrder) {
      // A hotel-guest discount reduces the taxable value of the sale, so service
      // charge and VAT have to be re-derived from the discounted net — taking it
      // off the total alone would leave the guest paying VAT on money they never
      // spent.
      const totals = calculateOrderTotals({
        subtotal: Number(order.subtotal),
        taxRate: Number(order.taxRate),
        serviceRate: Number(order.serviceRate),
        discount: Number(order.subtotal) * GUEST_DISCOUNT_RATE,
      });

      const updatedOrder = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          discount: totals.discount,
          serviceCharge: totals.serviceCharge,
          taxAmount: totals.taxAmount,
          total: totals.total,
        },
        include: {
          table: { select: { id: true, tableNumber: true } },
          items: { include: { menuItem: { select: { id: true, name: true } } } },
        },
      });

      return updatedOrder;
    }

    return order;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async recalculateTotals(
    orderId: string,
    currentOrder: { taxRate: unknown; serviceRate: unknown; discount: unknown },
  ) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId, status: { not: 'CANCELLED' } },
    });

    // Rates come off the order, not the outlet: a bill keeps the policy it was
    // opened under even if someone changes the outlet's settings mid-service.
    const totals = calculateOrderTotals({
      subtotal: items.reduce((sum, item) => sum + Number(item.totalPrice), 0),
      taxRate: Number(currentOrder.taxRate),
      serviceRate: Number(currentOrder.serviceRate),
      discount: Number(currentOrder.discount),
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        serviceCharge: totals.serviceCharge,
        total: totals.total,
      },
    });
  }

  /**
   * Work out which reservation a new bill belongs to, and hand back who that party
   * is so the bill can inherit it. An explicit id wins (and is validated against
   * the restaurant); otherwise a party already seated at that table is adopted, so
   * a walk-in order rung up on a reserved table still closes the booking when it
   * is paid.
   */
  private async resolveReservation(
    restaurantId: string,
    dto: CreateOrderDto,
    tenantId: string,
  ): Promise<{ id: string; guestName: string; partySize: number } | null> {
    const select = { id: true, guestName: true, partySize: true };

    if (dto.reservationId) {
      const reservation = await this.prisma.tableReservation.findFirst({
        where: { id: dto.reservationId, restaurantId, tenantId },
        select,
      });
      if (!reservation) {
        throw new NotFoundException(`Reservation ${dto.reservationId} not found`);
      }
      return reservation;
    }

    if (!dto.tableId) return null;

    return this.prisma.tableReservation.findFirst({
      where: { restaurantId, tenantId, tableId: dto.tableId, status: 'SEATED' },
      orderBy: { seatedAt: 'desc' },
      select,
    });
  }

  /**
   * Hand a table back to the floor once its bill is closed, and close the
   * reservation that bill belonged to. A table with other live orders on it
   * (split bills) stays OCCUPIED — but an item-less order is not a bill, so it
   * must not be what keeps a table out of service.
   */
  private async closeOutTable(
    order: { id: string; tableId: string | null; reservationId: string | null },
    nextStatus: 'CLEANING' | 'AVAILABLE',
  ): Promise<void> {
    if (order.tableId) {
      const otherActive = await this.prisma.order.count({
        where: {
          tableId: order.tableId,
          id: { not: order.id },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          items: { some: {} },
        },
      });

      if (otherActive === 0) {
        await this.prisma.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: nextStatus },
        });
      }
    }

    if (!order.reservationId) return;

    await this.prisma.tableReservation.updateMany({
      where: { id: order.reservationId, status: 'SEATED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  /**
   * Writes the bill, drawing a fresh number if the one it got is somehow taken.
   *
   * The sequence table makes a repeat draw very unlikely, but a bill that fails
   * to save is the floor staff's problem, not the database's — a POS that says
   * "This record already exists (orders_orderNumber_key)" while a table waits is
   * the worst possible outcome. So a duplicate costs one more round trip instead
   * of the order.
   */
  private async createWithFreshOrderNumber(
    tenantId: string,
    build: (orderNumber: string) => Parameters<PrismaService['order']['create']>[0],
  ) {
    let lastError: unknown;

    for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS; attempt++) {
      const orderNumber = await this.generateOrderNumber(tenantId);
      try {
        return await this.prisma.order.create(build(orderNumber));
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        lastError = error;
        this.logger.warn(
          `Order number ${orderNumber} was already taken — drawing another (attempt ${attempt + 1})`,
        );
      }
    }

    this.logger.error(
      `Could not find a free order number for tenant ${tenantId} after ${ORDER_NUMBER_ATTEMPTS} attempts`,
      lastError instanceof Error ? lastError.stack : undefined,
    );
    throw new BadRequestException('ออกเลขบิลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  }

  /**
   * Hands out the next bill number for a tenant's day.
   *
   * Backed by `document_sequences` — the same counter table journal entries and
   * guest folios use — because the number this returns has to be one nobody else
   * gets. The old version derived it from `count(orders today)`, which broke in
   * three separate ways:
   *
   *   - two bills opened at the same moment read the same count
   *   - deleting or voiding a bill lowered the count, so the next one reused a
   *     number that was already printed on a receipt
   *   - the count window used local midnight while the date in the number used
   *     the UTC date, so between 00:00 and 07:00 Bangkok time it handed out
   *     yesterday's numbers all over again
   *
   * `upsert` with `increment` is a single atomic statement, so none of that
   * applies here: every caller walks away with a different number.
   */
  private async generateOrderNumber(tenantId: string): Promise<string> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `ORD-${dateStr}-`;

    await this.seedOrderSequence(tenantId, dateStr, prefix);

    const seq = await this.prisma.documentSequence.upsert({
      where: {
        tenantId_docType_yearMonth: { tenantId, docType: ORDER_DOC_TYPE, yearMonth: dateStr },
      },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId, docType: ORDER_DOC_TYPE, prefix: 'ORD', yearMonth: dateStr, lastNumber: 1 },
    });

    return `${prefix}${String(seq.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Starts the day's counter above whatever the old count-based generator
   * already wrote. Without this the first bill after deploy would ask for 0001
   * on a day that already has one, and collide on its own tenant's rows.
   * Runs once per tenant per day — after that the row exists and this is a no-op.
   */
  private async seedOrderSequence(tenantId: string, dateStr: string, prefix: string) {
    // findFirst, not findUnique — the tenant-scope middleware rejects findUnique
    // on tenant-scoped models because it cannot fold the tenant filter into it.
    const existing = await this.prisma.documentSequence.findFirst({
      where: { tenantId, docType: ORDER_DOC_TYPE, yearMonth: dateStr },
      select: { id: true },
    });

    if (existing) return;

    const written = await this.prisma.order.findMany({
      where: { tenantId, orderNumber: { startsWith: prefix } },
      select: { orderNumber: true },
    });

    // Highest sequence actually on a bill — read numerically, not by string
    // order, so 0009 → 0010 does not become 0009 → 0001 once past 9999.
    const highest = written.reduce((max, row) => {
      const parsed = Number.parseInt(row.orderNumber.slice(prefix.length), 10);
      return Number.isNaN(parsed) ? max : Math.max(max, parsed);
    }, 0);

    try {
      await this.prisma.documentSequence.create({
        data: {
          tenantId,
          docType: ORDER_DOC_TYPE,
          prefix: 'ORD',
          yearMonth: dateStr,
          lastNumber: highest,
        },
      });
    } catch (error) {
      // Another bill opened at the same instant created the row first — fine,
      // the upsert that follows increments whichever row won.
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
}
