import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

interface AuthenticatePayload {
  tenantId: string;
  userId: string;
}

@WebSocketGateway({ namespace: '/messaging', cors: { origin: '*' } })
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagingGateway.name);
  // tenantId -> Set<socketId>
  private tenantSockets = new Map<string, Set<string>>();

  handleConnection(client: Socket) {
    this.logger.log(`[WS] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[WS] Client disconnected: ${client.id}`);
    for (const [tenantId, sockets] of this.tenantSockets.entries()) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.tenantSockets.delete(tenantId);
    }
  }

  @SubscribeMessage('authenticate')
  handleAuthenticate(
    @MessageBody() payload: AuthenticatePayload,
    @ConnectedSocket() client: Socket,
  ) {
    const { tenantId } = payload;
    if (!tenantId) {
      client.emit('error', { message: 'tenantId required' });
      return;
    }
    if (!this.tenantSockets.has(tenantId)) {
      this.tenantSockets.set(tenantId, new Set());
    }
    this.tenantSockets.get(tenantId)!.add(client.id);
    client.join(`tenant:${tenantId}`);
    client.emit('authenticated', { tenantId });
    this.logger.log(`[WS] Staff authenticated for tenant=${tenantId}`);
  }

  // ─── Emit helpers (called by services) ───────────────────────────────────────

  /** Broadcast new inbound message to all staff in a tenant */
  emitNewMessage(tenantId: string, payload: unknown) {
    this.server.to(`tenant:${tenantId}`).emit('new_message', payload);
  }

  /** Broadcast conversation update (e.g. lastMessageAt changed) */
  emitConversationUpdate(tenantId: string, payload: unknown) {
    this.server.to(`tenant:${tenantId}`).emit('conversation_updated', payload);
  }
}
