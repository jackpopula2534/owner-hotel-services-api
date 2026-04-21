// Event names used across modules
export const INVENTORY_EVENTS = {
  // Housekeeping events (emitted by HousekeepingService)
  HOUSEKEEPING_TASK_COMPLETED: 'housekeeping.task.completed',
  // Maintenance events (emitted by MaintenanceService)
  MAINTENANCE_TASK_COMPLETED: 'maintenance.task.completed',
  // Restaurant events (emitted by RestaurantService)
  RESTAURANT_ORDER_COMPLETED: 'restaurant.order.completed',
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
