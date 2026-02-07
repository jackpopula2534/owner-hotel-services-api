import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Map to store userId -> socketId
  private userSockets = new Map<string, string[]>();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    // Clean up userSockets map
    for (const [userId, socketIds] of this.userSockets.entries()) {
      const remainingSockets = socketIds.filter((id) => id !== client.id);
      if (remainingSockets.length === 0) {
        this.userSockets.delete(userId);
      } else {
        this.userSockets.set(userId, remainingSockets);
      }
    }
  }

  @SubscribeMessage('authenticate')
  handleAuthenticate(client: Socket, payload: { userId: string }) {
    const { userId } = payload;
    if (userId) {
      const userSocketIds = this.userSockets.get(userId) || [];
      if (!userSocketIds.includes(client.id)) {
        userSocketIds.push(client.id);
        this.userSockets.set(userId, userSocketIds);
      }
      return { status: 'authenticated' };
    }
  }

  sendToUser(userId: string, event: string, data: any) {
    const socketIds = this.userSockets.get(userId);
    if (socketIds) {
      socketIds.forEach((socketId) => {
        this.server.to(socketId).emit(event, data);
      });
    }
  }

  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }
}
