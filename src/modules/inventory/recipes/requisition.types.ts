// Shared vocabulary for the recipe → requisition → purchase chain. The planner
// (RecipeRequisitionService) and the document (MaterialRequisitionService) both
// speak it, so it lives apart from either.

/** The Integration Hub switch that makes this whole feature exist. */
export const REQUISITION_INTEGRATION_KEY = 'restaurant-inventory-requisition';

/** Stamped on every movement so an issued requisition stays traceable. */
export const REQUISITION_REF_TYPE = 'RECIPE_REQUISITION';

/** `DocumentSequence.docType` for the requisition running number. */
export const REQUISITION_DOC_TYPE = 'MATERIAL_REQUISITION';
export const REQUISITION_DOC_PREFIX = 'RCP';

export const REQUISITION_OFF_MESSAGE =
  'การเชื่อมต่อ "สร้างใบเบิกวัตถุดิบจากสูตรอาหาร" ถูกปิดอยู่ — เปิดได้ที่ ตั้งค่า → การเชื่อมต่อระบบ';

export interface RequisitionWarehouse {
  id: string;
  name: string;
  code: string;
  type: string;
  isDefault: boolean;
}

export interface RequisitionLinePlan {
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  /** Exact need including wastage — fractional, shown so the rounding is visible. */
  requiredQty: number;
  /** What the kitchen already holds; a full shelf means nothing to requisition. */
  onHandQty: number;
  shortageQty: number;
  /** `ceil(shortage)` — `StockMovement.quantity` is an Int, so this is what ships. */
  suggestedQty: number;
  sourceQty: number;
  enough: boolean;
  usedBy: { menuItemName: string; qty: number }[];
}

export interface RequisitionPlan {
  kitchenWarehouse: RequisitionWarehouse | null;
  sourceWarehouses: RequisitionWarehouse[];
  sourceWarehouseId: string | null;
  menus: { menuItemId: string; menuItemName: string; plates: number; servings: number }[];
  lines: RequisitionLinePlan[];
  /** Free-text recipe ingredients — real cost, but nothing the warehouse can issue. */
  unlinked: { name: string; menus: string[] }[];
  warnings: string[];
}

/** Recipe quantities are `Decimal(10,3)` — keep the same resolution on the way out. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
