// Cost Accounting event names
export const COST_EVENTS = {
  // Fired by inventory when a stock movement is created
  STOCK_MOVEMENT_CREATED: 'inventory.stock_movement.created',
  // Fired by HR payroll when salary is processed
  PAYROLL_PROCESSED: 'hr.payroll.processed',
  // Fired by bookings when checkout is completed (for revenue posting)
  BOOKING_CHECKOUT_COMPLETED: 'booking.checkout.completed',
} as const;

// Event payloads
export interface StockMovementCreatedEvent {
  movementId: string;
  tenantId: string;
  propertyId: string;
  warehouseId: string;
  itemId: string;
  itemName: string;
  type: string; // GOODS_ISSUE, GOODS_RECEIVE, etc.
  quantity: number;
  totalCost: number;
  referenceType?: string; // housekeeping_task, maintenance_task, restaurant_order
  referenceId?: string;
  createdBy: string;
}

export interface PayrollProcessedEvent {
  tenantId: string;
  propertyId: string;
  period: string; // "YYYY-MM"
  departmentId: string;
  departmentName: string;
  totalSalary: number;
  totalBenefits: number;
  totalOvertime: number;
}

export interface BookingCheckoutCompletedEvent {
  bookingId: string;
  tenantId: string;
  propertyId: string;
  roomType: string;
  totalPrice: number;
  serviceCharge: number;
  vat: number;
  checkOutDate: string;
}
