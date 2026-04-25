import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import {
  INVENTORY_EVENTS,
  GoodsReceiveCompletedEvent,
  PurchaseOrderReceivedEvent,
} from '../events/inventory.events';

/**
 * Sprint 5 — Realtime broadcaster for the procurement role.
 *
 * Sits between the in-process EventEmitter (which the GR service emits to
 * when a receipt commits) and the procurement front-end. Sockets join a
 * tenant-scoped room (`procurement:{tenantId}`) so a notification fired
 * from one user's GR scan reaches every buyer in the same org — but no one
 * in another tenant.
 *
 * Outbound events on the WS layer:
 *   `gr.completed` — payload = GoodsReceiveCompletedEvent
 *   `po.received`  — payload = PurchaseOrderReceivedEvent
 *
 * Client must `emit('procurement.subscribe', { tenantId })` after connect to
 * be put in the right room. We don't auto-discover tenant from auth here
 * because this gateway has no JWT guard (yet) — the room name is the
 * authorization boundary, and clients only know their own tenantId.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'procurement',
})
export class ProcurementEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ProcurementEventsGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`procurement client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`procurement client disconnected: ${client.id}`);
  }

  /**
   * Client opt-in to a tenant room. Sending an empty/missing tenantId leaves
   * the socket out of all rooms — it will never receive broadcasts.
   */
  @SubscribeMessage('procurement.subscribe')
  handleSubscribe(client: Socket, payload: { tenantId?: string }): {
    status: 'subscribed' | 'rejected';
    room?: string;
  } {
    if (!payload?.tenantId) return { status: 'rejected' };
    const room = `procurement:${payload.tenantId}`;
    void client.join(room);
    return { status: 'subscribed', room };
  }

  /** Allow clients to leave proactively (e.g. on logout). */
  @SubscribeMessage('procurement.unsubscribe')
  handleUnsubscribe(client: Socket, payload: { tenantId?: string }): { status: 'unsubscribed' } {
    if (payload?.tenantId) {
      void client.leave(`procurement:${payload.tenantId}`);
    }
    return { status: 'unsubscribed' };
  }

  // ─── Inbound NestJS events → outbound WS broadcasts ───────────────────────

  @OnEvent(INVENTORY_EVENTS.GR_COMPLETED, { async: true })
  handleGrCompleted(event: GoodsReceiveCompletedEvent): void {
    if (!this.server) return; // gateway not initialized yet (e.g. during test)
    const room = `procurement:${event.tenantId}`;
    this.server.to(room).emit('gr.completed', event);
    this.logger.log(
      `→ ${room} gr.completed ${event.grNumber} (po=${event.purchaseOrderId ?? 'walk-in'})`,
    );
  }

  @OnEvent(INVENTORY_EVENTS.PO_RECEIVED, { async: true })
  handlePoReceived(event: PurchaseOrderReceivedEvent): void {
    if (!this.server) return;
    const room = `procurement:${event.tenantId}`;
    this.server.to(room).emit('po.received', event);
    this.logger.log(
      `→ ${room} po.received ${event.poNumber} ${event.oldStatus}→${event.newStatus} ${event.percent}%`,
    );
  }
}
