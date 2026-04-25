// Event names used across modules
export const INVENTORY_EVENTS = {
  // Housekeeping events (emitted by HousekeepingService)
  HOUSEKEEPING_TASK_COMPLETED: 'housekeeping.task.completed',
  // Maintenance events (emitted by MaintenanceService)
  MAINTENANCE_TASK_COMPLETED: 'maintenance.task.completed',
  // Restaurant events (emitted by RestaurantService)
  RESTAURANT_ORDER_COMPLETED: 'restaurant.order.completed',

  // ─── Sprint 2: Procurement ↔ Warehouse link ────────────────────────────────
  /** Emitted by GoodsReceivesService AFTER a GR is committed and stock is updated. */
  GR_COMPLETED: 'gr.completed',
  /** Emitted by PurchaseOrdersService when a PO transitions to PARTIAL/FULL/CLOSED. */
  PO_RECEIVED: 'po.received',
} as const;

// Event payloads
export interface HousekeepingTaskCompletedEvent {
  taskId: string;
  tenantId: string;
  roomId: string;
  roomType: string; // e.g. "deluxe"
  taskType: string; // e.g. "checkout", "daily"
  propertyId: string;
  completedBy: string; // userId
}

export interface MaintenanceTaskCompletedEvent {
  taskId: string;
  tenantId: string;
  propertyId: string;
  roomId?: string;
  partsUsed: Array<{
    itemId: string;
    quantity: number;
  }>;
  warehouseId?: string; // if specified, deduct from this warehouse
  completedBy: string;
}

export interface RestaurantOrderCompletedEvent {
  orderId: string;
  tenantId: string;
  restaurantId: string;
  propertyId: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
  }>;
  completedBy: string;
}

// ─── Sprint 2: Procurement ↔ Warehouse link payloads ───────────────────────────

/**
 * Emitted after a GoodsReceive is created (or updated to ACCEPTED) and stock has
 * been written. Consumers in the procurement module can use this to refresh
 * tracking views or push WS notifications without coupling to GR internals.
 */
export interface GoodsReceiveCompletedEvent {
  grId: string;
  grNumber: string;
  tenantId: string;
  warehouseId: string;
  purchaseOrderId: string | null;
  status: 'DRAFT' | 'INSPECTING' | 'ACCEPTED' | 'PARTIAL_REJECT' | 'REJECTED';
  items: Array<{
    itemId: string;
    receivedQty: number;
    rejectedQty: number;
    lotId: string | null;
    expiryDate: string | null;
  }>;
  receivedBy: string;
}

/**
 * Emitted whenever a PO's status is recomputed after a GR commit. Carries the
 * cumulative progress so listeners (notifications, websocket broadcaster) can
 * render meaningful messages without re-querying.
 */
export interface PurchaseOrderReceivedEvent {
  purchaseOrderId: string;
  poNumber: string;
  tenantId: string;
  oldStatus: string;
  newStatus: 'PARTIALLY_RECEIVED' | 'FULLY_RECEIVED';
  percent: number;
  orderedQty: number;
  receivedQty: number;
  triggeredByGrId: string;
}
