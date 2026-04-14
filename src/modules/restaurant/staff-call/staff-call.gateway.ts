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

@WebSocketGateway({
  namespace: '/staff-calls',
  cors: { origin: '*', credentials: true },
})
export class StaffCallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(StaffCallGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Staff-call client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Staff-call client disconnected: ${client.id}`);
  }

  // ─── Client subscribes to a restaurant's staff calls ─────────────────────────
  @SubscribeMessage('join-staff-calls')
  handleJoin(
    @MessageBody() data: { restaurantId: string; tenantId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `staff-calls:${data.tenantId}:${data.restaurantId}`;
    client.join(room);
    this.logger.log(`Client ${client.id} joined staff-calls room: ${room}`);
    return { event: 'joined', room };
  }

  @SubscribeMessage('leave-staff-calls')
  handleLeave(
    @MessageBody() data: { restaurantId: string; tenantId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `staff-calls:${data.tenantId}:${data.restaurantId}`;
    client.leave(room);
    return { event: 'left', room };
  }

  // ─── Emit events (called from StaffCallService) ─────────────────────────────

  emitNewCall(tenantId: string, restaurantId: string, call: unknown) {
    const room = `staff-calls:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('staff-call:new', call);
    this.logger.log(`Emitted staff-call:new to room ${room}`);
  }

  emitCallUpdated(tenantId: string, restaurantId: string, call: unknown) {
    const room = `staff-calls:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('staff-call:updated', call);
  }

  emitCallResolved(tenantId: string, restaurantId: string, call: unknown) {
    const room = `staff-calls:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('staff-call:resolved', call);
  }

  emitAllResolved(tenantId: string, restaurantId: string) {
    const room = `staff-calls:${tenantId}:${restaurantId}`;
    this.server.to(room).emit('staff-call:all-resolved', { restaurantId });
  }
}
