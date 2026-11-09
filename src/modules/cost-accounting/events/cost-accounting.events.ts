// Cost Accounting event names
export const COST_EVENTS = {
  // Fired by inventory when a stock movement is created
  STOCK_MOVEMENT_CREATED: 'inventory.stock_movement.created',
  // Fired by HR payroll when salary is processed
  PAYROLL_PROCESSED: 'hr.payroll.processed',
  // Fired by bookings when checkout is completed (for revenue posting)
  BOOKING_CHECKOUT_COMPLETED: 'booking.checkout.completed',
  // Fired by HR recruitment when a manpower budget is fully approved (Stage 2)
  RECRUITMENT_BUDGET_RESERVED: 'hr.recruitment.budget_reserved',
  // Fired by HR recruitment when a candidate is hired — monthly salary committed (Stage 5)
  RECRUITMENT_SALARY_COMMITTED: 'hr.recruitment.salary_committed',
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
  referenceType?: string; // housekeeping_task, maintenance_task, restaurant_order, equipment_issuance
  referenceId?: string;
  departmentId?: string | null; // เจ้าของต้นทุน (equipment_issuance) → map ไป cost center ของแผนก
  createdBy: string;
}

export interface RecruitmentBudgetReservedEvent {
  manpowerRequestId: string;
  requestNo: string;
  tenantId: string;
  propertyId: string | null;
  departmentId: string | null;
  positionTitle: string;
  headcount: number;
  budgetTotal: number;
  createdBy: string;
}

export interface RecruitmentSalaryCommittedEvent {
  hireRecordId: string;
  manpowerRequestId: string;
  tenantId: string;
  propertyId: string | null;
  departmentId: string | null;
  positionTitle: string;
  employeeId: string;
  monthlySalary: number;
  startDate: string; // ISO date
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
