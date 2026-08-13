import { Prisma } from '@prisma/client';

/**
 * สรุปว่าใบขอซื้อใบนี้ "ได้ของแล้วเท่าไหร่" จากใบรับของที่ผูกไว้
 *
 * A requisition closed by a market run is still CLOSED — the same word used when
 * a requisition is abandoned. The status alone therefore cannot answer the only
 * question anyone asks about a closed document: did the goods arrive or not?
 * These helpers derive that answer from the receipts themselves rather than from
 * a new status column, so the two can never disagree: if a receipt exists the
 * goods are on the shelf, and no flag can claim otherwise.
 */

/** Prisma คืน Decimal มา แต่ JSON ต้องเป็นตัวเลข ไม่งั้นฝั่งหน้าเว็บได้ object เปล่า */
export function toAmount(
  value: Prisma.Decimal | number | string | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export interface ReceiveItemRow {
  itemId: string;
  receivedQty: number;
  unitCost: Prisma.Decimal | number;
  totalCost: Prisma.Decimal | number;
}

export interface ReceiveRow {
  id: string;
  grNumber: string;
  receiveDate: Date;
  status: string;
  source: string;
  vendorName: string | null;
  paymentMethod: string | null;
  hasNoReceipt: boolean;
  invoiceNumber: string | null;
  totalAmount: Prisma.Decimal | number;
  paidBy: string | null;
  warehouse?: { name: string } | null;
  items: ReceiveItemRow[];
}

/** ใบรับของที่ผูกกับใบขอซื้อ ในรูปที่ส่งออกทาง API ได้ */
export interface LinkedGoodsReceive {
  id: string;
  grNumber: string;
  receiveDate: Date;
  status: string;
  source: string;
  vendorName: string | null;
  paymentMethod: string | null;
  hasNoReceipt: boolean;
  invoiceNumber: string | null;
  warehouseName: string | null;
  totalAmount: number;
  itemCount: number;
  paidByName: string | null;
}

export function mapLinkedReceives(
  rows: ReceiveRow[],
  userNames: Map<string, string>,
): LinkedGoodsReceive[] {
  return rows.map((row) => ({
    id: row.id,
    grNumber: row.grNumber,
    receiveDate: row.receiveDate,
    status: row.status,
    source: row.source,
    vendorName: row.vendorName,
    paymentMethod: row.paymentMethod,
    hasNoReceipt: row.hasNoReceipt,
    invoiceNumber: row.invoiceNumber,
    warehouseName: row.warehouse?.name ?? null,
    totalAmount: toAmount(row.totalAmount),
    itemCount: row.items.length,
    paidByName: row.paidBy ? (userNames.get(row.paidBy) ?? null) : null,
  }));
}

export interface ItemFulfillment {
  receivedQty: number;
  /**
   * ราคาต่อหน่วยที่จ่ายจริง — ถัวเฉลี่ยถ่วงน้ำหนักเมื่อไปซื้อหลายรอบ
   * ไปตลาดสองครั้งได้ราคาคนละราคา ตัวเลขเดียวที่ถูกต้องคือค่าเฉลี่ยตามจำนวน
   * ไม่ใช่ราคาครั้งล่าสุดหรือครั้งแรก
   */
  actualUnitCost: number | null;
  actualTotalCost: number;
}

export function fulfillmentByItem(rows: ReceiveRow[]): Map<string, ItemFulfillment> {
  const acc = new Map<string, { qty: number; cost: number }>();
  for (const row of rows) {
    for (const line of row.items) {
      const prev = acc.get(line.itemId) ?? { qty: 0, cost: 0 };
      acc.set(line.itemId, {
        qty: prev.qty + (line.receivedQty || 0),
        cost: prev.cost + toAmount(line.totalCost),
      });
    }
  }

  const out = new Map<string, ItemFulfillment>();
  for (const [itemId, { qty, cost }] of acc) {
    out.set(itemId, {
      receivedQty: qty,
      actualUnitCost: qty > 0 ? Math.round((cost / qty) * 100) / 100 : null,
      actualTotalCost: Math.round(cost * 100) / 100,
    });
  }
  return out;
}

export interface FulfillmentSummary {
  receiptCount: number;
  cashPurchaseCount: number;
  totalPaid: number;
  linesRequested: number;
  /** บรรทัดที่ได้ของมาแล้วอย่างน้อยบางส่วน */
  linesReceived: number;
  /** บรรทัดที่ได้ของครบตามที่ขอ */
  linesComplete: number;
  /**
   * ของที่ซื้อมาแต่ไม่ได้อยู่ในใบขอซื้อ
   * ไปตลาดแล้วเจอของถูกก็หยิบเพิ่ม เป็นเรื่องปกติ แต่ต้องบอกให้เห็น ไม่ใช่ปล่อยให้
   * คนอ่านสรุปเข้าใจว่าทุกอย่างในใบรับของมาจากใบขอซื้อใบนี้
   */
  extraLines: number;
  fullyReceived: boolean;
}

export function summariseFulfillment(
  requestedItems: { itemId: string; quantity: number }[],
  rows: ReceiveRow[],
): FulfillmentSummary {
  const byItem = fulfillmentByItem(rows);
  const requestedIds = new Set(requestedItems.map((i) => i.itemId));

  let linesReceived = 0;
  let linesComplete = 0;
  for (const req of requestedItems) {
    const got = byItem.get(req.itemId)?.receivedQty ?? 0;
    if (got > 0) linesReceived += 1;
    if (got >= req.quantity) linesComplete += 1;
  }

  let extraLines = 0;
  for (const itemId of byItem.keys()) {
    if (!requestedIds.has(itemId)) extraLines += 1;
  }

  const totalPaid = rows.reduce((sum, row) => sum + toAmount(row.totalAmount), 0);

  return {
    receiptCount: rows.length,
    cashPurchaseCount: rows.filter((r) => r.source === 'CASH_PURCHASE').length,
    totalPaid: Math.round(totalPaid * 100) / 100,
    linesRequested: requestedItems.length,
    linesReceived,
    linesComplete,
    extraLines,
    // ใบที่ไม่มีรายการเลย ไม่นับว่า "ได้ของครบ" — ไม่มีอะไรให้ครบตั้งแต่แรก
    fullyReceived: requestedItems.length > 0 && linesComplete === requestedItems.length,
  };
}
