import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface KitchenEventPayload {
  restaurantId: string;
  tenantId: string;
  data: unknown;
}

@WebSocketGateway({
  namespace: '/kitchen',
  cors: { origin: '*', credentials: true },
})
export class KitchenGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KitchenGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Kitchen client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Kitchen client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-kitchen')
  handleJoinKitchen(
    @MessageBody() data: { restaurantId: string; tenantId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `kitchen:${data.tenantId}:${data.restaurantId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined kitchen room: ${room}`);
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave-kitchen')
  handleLeaveKitchen(
    @MessageBody() data: { restaurantId: string; tenantId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `kitchen:${data.tenantId}:${data.restaurantId}`;
    client.leave(room);
    return { event: 'left', room };
  }

  // ─── Emit Events (called from services) ──────────────────────────────────

  emitNewOrder(tenantId: string, restaurantId: string, order: unknown) {
    const room = `kitchen:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('kitchen:new-order', order);
    this.logger.log(`Emitted kitchen:new-order to room ${room}`);
  }

  emitOrderUpdated(tenantId: string, restaurantId: string, order: unknown) {
    const room = `kitchen:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('kitchen:order-updated', order);
  }

  emitOrderCompleted(tenantId: string, restaurantId: string, order: unknown) {
    const room = `kitchen:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('kitchen:order-completed', order);
    this.logger.log(`Emitted kitchen:order-completed to room ${room}`);
  }

  emitItemStatusChanged(tenantId: string, restaurantId: string, item: unknown) {
    const room = `kitchen:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('kitchen:item-updated', item);
  }

  emitOrderStatusToGuest(orderNumber: string, status: unknown) {
    this.server.emit(`order:${orderNumber}:status`, status);
  }
}
