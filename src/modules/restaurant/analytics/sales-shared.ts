/**
 * Shared vocabulary for the outlet revenue reports (daily + monthly).
 *
 * Both reports answer the same question over a different window, so the window
 * maths, the money aggregation and the row shapes live here — if the daily and
 * monthly screens ever disagreed on what "netSales" means, the numbers a manager
 * reconciles against the till would silently stop matching.
 */

// The calendar maths is shared with every other report that has to cut the day
// at Bangkok midnight (the Command Center overview, for one), so it lives in
// common/ and is re-exported here for the callers that already import it.
export {
  DAY_MS,
  BANGKOK_OFFSET_MS,
  round2,
  toBangkokDate,
  toBangkokMonth,
  bangkokDayRange,
  bangkokMonthRange,
  shiftDate,
  shiftMonth,
  daysOfMonth,
  bangkokHour,
  bucketOfDay,
  businessDateOf,
} from '../../../common/utils/bangkok-day.util';
export type { DayGrouping } from '../../../common/utils/bangkok-day.util';

import { round2 } from '../../../common/utils/bangkok-day.util';
import { CASH_COLLECTED_ORDER_PAYMENT_STATUSES } from '../../../common/constants/revenue-recognition.const';
import type { RevenueDocument } from '../../revenue/revenue-query.service';

export interface SalesTotals {
  /** Σ subtotal — menu value sold, before discount/service/tax. */
  grossSales: number;
  discount: number;
  /** grossSales − discount. The base every downstream charge is computed from. */
  netSales: number;
  serviceCharge: number;
  tax: number;
  /**
   * Σ order total of every closed bill — revenue recognized, cash or not.
   * Name kept for the screens that already read it.
   */
  totalCollected: number;
  /** Subset of totalCollected where money crossed the counter — reconciles to the drawer. */
  cashCollected: number;
  /** Subset of totalCollected signed to a guest room — a receivable on the folio, not cash. */
  roomCharged: number;
  orders: number;
  guests: number;
  averageOrderValue: number;
  averagePartySize: number;
}

export interface SalesBreakdownRow {
  key: string;
  orders: number;
  amount: number;
  /** Share of totalCollected, 0–100. */
  share: number;
}

export interface SalesTopItem {
  menuItemId: string;
  name: string;
  category: string;
  quantity: number;
  revenue: number;
}

export interface SalesOperations {
  /** Orders opened during the window, whatever became of them. */
  opened: number;
  completed: number;
  cancelled: number;
  /** Still open at the time of the request. */
  active: number;
}

/** Shape selected by the paid-orders query — Decimal columns arrive as objects, hence `unknown`-safe `Number()`. */
export interface PaidOrderRow {
  subtotal: unknown;
  discount: unknown;
  serviceCharge: unknown;
  taxAmount: unknown;
  total: unknown;
  partySize: number | null;
  paymentMethod: string | null;
  /** PAID vs CHARGED_TO_ROOM — both are revenue, only the first is cash. */
  paymentStatus: string;
  orderType: string;
  completedAt: Date | null;
}

export interface SoldItemRow {
  quantity: number;
  totalPrice: unknown;
  menuItem: { id: string; name: string; category: { name: string } | null };
}

/** มิติของบิลที่สมุดรายได้ไม่ได้เก็บ — ต้องอ่านจากตาราง orders */
export interface OrderDimensionRow {
  id: string;
  partySize: number | null;
  paymentMethod: string | null;
  paymentStatus: string;
  orderType: string;
  completedAt: Date | null;
}

/** คอลัมน์ที่ต้อง select ให้ {@link joinLedgerOrders} ทำงานได้ */
export const ORDER_DIMENSION_SELECT = {
  id: true,
  partySize: true,
  paymentMethod: true,
  paymentStatus: true,
  orderType: true,
  completedAt: true,
} as const;

/** หนึ่งบิลที่ลงสมุดแล้ว — เงินมาจากสมุด มิติปฏิบัติการมาจากใบสั่ง */
export interface LedgerOrderRow extends PaidOrderRow {
  orderId: string;
  /** วันธุรกิจที่สมุดลงบิลใบนี้ไว้ ('YYYY-MM-DD') — ไม่ต้องคำนวณจาก completedAt ซ้ำ */
  businessDate: string;
}

/**
 * ต่อแถวสมุดรายได้เข้ากับใบสั่งของมัน
 *
 * ทุกตัวเลขเงินมาจากสมุด (`grossAmount`/`discount`/`serviceCharge`/`taxAmount`/
 * `totalAmount`) ส่วนใบสั่งให้เฉพาะสิ่งที่สมุดไม่เก็บ: จำนวนคน ประเภทบิล ช่องทางจ่าย
 * และเวลาปิดบิลสำหรับกราฟรายชั่วโมง วิธีนี้ยอดรวมของทุกกราฟย่อยจึงเท่ากับยอดรวม
 * ของหน้าจอเสมอ เพราะมาจากแถวเดียวกัน
 *
 * บิลที่หาใบสั่งไม่เจอ (ถูกลบทิ้งหลังลงสมุด) ยังต้องนับเงิน — ตกเป็นถัง UNKNOWN
 * ดีกว่าปล่อยให้ยอดหายไปเงียบ ๆ
 */
export const joinLedgerOrders = (
  documents: RevenueDocument[],
  orders: OrderDimensionRow[],
): LedgerOrderRow[] => {
  const byId = new Map(orders.map((order) => [order.id, order]));

  return documents.map((doc) => {
    const order = byId.get(doc.sourceId);
    return {
      orderId: doc.sourceId,
      businessDate: doc.businessDate,
      subtotal: doc.gross,
      discount: doc.discount,
      serviceCharge: doc.serviceCharge,
      taxAmount: doc.tax,
      total: doc.total,
      partySize: order?.partySize ?? null,
      paymentMethod: order?.paymentMethod ?? null,
      paymentStatus: order?.paymentStatus ?? 'PAID',
      orderType: order?.orderType ?? 'UNKNOWN',
      completedAt: order?.completedAt ?? null,
    };
  });
};

/** เงินของบิลหนึ่งใบตามสมุด — รวมทุกแถวของ sourceId เดียวกันแล้ว */
export interface LedgerBillMoney {
  gross: number;
  discount: number;
  net: number;
  serviceCharge: number;
  tax: number;
  total: number;
}

/**
 * ยุบแถวสมุดให้เหลือใบละหนึ่งยอด
 *
 * บิลใบเดียวโผล่ได้หลายแถวเมื่อถูกกลับรายการคนละวัน (แถวเดิมบวก แถว REVERSAL ลบ)
 * รายงานที่แยกตามมิติของ "ใบสั่ง" เช่นโต๊ะหรือพนักงาน จึงต้องรวมก่อน ไม่งั้นบิลเดียว
 * ถูกนับสองครั้งและยอดโต๊ะจะไม่เท่ากับยอดหน้าจอ
 */
export const moneyBySource = (documents: RevenueDocument[]): Map<string, LedgerBillMoney> => {
  const bills = new Map<string, LedgerBillMoney>();

  for (const doc of documents) {
    const bill = bills.get(doc.sourceId) ?? {
      gross: 0,
      discount: 0,
      net: 0,
      serviceCharge: 0,
      tax: 0,
      total: 0,
    };
    bills.set(doc.sourceId, {
      gross: bill.gross + doc.gross,
      discount: bill.discount + doc.discount,
      net: bill.net + doc.net,
      serviceCharge: bill.serviceCharge + doc.serviceCharge,
      tax: bill.tax + doc.tax,
      total: bill.total + doc.total,
    });
  }

  return bills;
};

// ─── Aggregation ───────────────────────────────────────────────────────────

/** True when the bill was settled at the till rather than signed to a room. */
const isCashOrder = (order: PaidOrderRow): boolean =>
  (CASH_COLLECTED_ORDER_PAYMENT_STATUSES as string[]).includes(order.paymentStatus);

export const sumTotals = (orders: PaidOrderRow[]): SalesTotals => {
  const acc = orders.reduce(
    (sum, o) => ({
      grossSales: sum.grossSales + Number(o.subtotal),
      discount: sum.discount + Number(o.discount ?? 0),
      serviceCharge: sum.serviceCharge + Number(o.serviceCharge ?? 0),
      tax: sum.tax + Number(o.taxAmount ?? 0),
      totalCollected: sum.totalCollected + Number(o.total),
      // A bill signed to a room is revenue the moment it closes, but the drawer
      // stays shut — split the two so neither figure has to lie.
      cashCollected: sum.cashCollected + (isCashOrder(o) ? Number(o.total) : 0),
      roomCharged: sum.roomCharged + (isCashOrder(o) ? 0 : Number(o.total)),
      guests: sum.guests + (o.partySize ?? 1),
    }),
    {
      grossSales: 0,
      discount: 0,
      serviceCharge: 0,
      tax: 0,
      totalCollected: 0,
      cashCollected: 0,
      roomCharged: 0,
      guests: 0,
    },
  );

  const count = orders.length;

  return {
    grossSales: round2(acc.grossSales),
    discount: round2(acc.discount),
    netSales: round2(acc.grossSales - acc.discount),
    serviceCharge: round2(acc.serviceCharge),
    tax: round2(acc.tax),
    totalCollected: round2(acc.totalCollected),
    cashCollected: round2(acc.cashCollected),
    roomCharged: round2(acc.roomCharged),
    orders: count,
    guests: acc.guests,
    averageOrderValue: count > 0 ? round2(acc.totalCollected / count) : 0,
    averagePartySize: count > 0 ? Math.round((acc.guests / count) * 10) / 10 : 0,
  };
};

export const breakdown = (
  orders: PaidOrderRow[],
  keyOf: (order: PaidOrderRow) => string,
  totals: SalesTotals,
): SalesBreakdownRow[] => {
  const rows = new Map<string, { key: string; orders: number; amount: number }>();

  for (const order of orders) {
    const key = keyOf(order);
    const row = rows.get(key) ?? { key, orders: 0, amount: 0 };
    row.orders += 1;
    row.amount += Number(order.total);
    rows.set(key, row);
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      amount: round2(row.amount),
      share: totals.totalCollected > 0 ? round2((row.amount / totals.totalCollected) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
};

export const rankTopItems = (items: SoldItemRow[], limit: number): SalesTopItem[] => {
  const rows = new Map<string, SalesTopItem>();

  for (const item of items) {
    const id = item.menuItem.id;
    const row = rows.get(id) ?? {
      menuItemId: id,
      name: item.menuItem.name,
      category: item.menuItem.category?.name ?? 'Uncategorized',
      quantity: 0,
      revenue: 0,
    };
    row.quantity += item.quantity;
    row.revenue += Number(item.totalPrice);
    rows.set(id, row);
  }

  return Array.from(rows.values())
    .map((row) => ({ ...row, revenue: round2(row.revenue) }))
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, limit);
};

export const countOperations = (orders: { status: string }[]): SalesOperations => ({
  opened: orders.length,
  completed: orders.filter((o) => o.status === 'COMPLETED').length,
  cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
  active: orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status)).length,
});

/** Columns the paid-orders query must select for the aggregation above to work. */
export const PAID_ORDER_SELECT = {
  subtotal: true,
  discount: true,
  serviceCharge: true,
  taxAmount: true,
  total: true,
  partySize: true,
  paymentMethod: true,
  paymentStatus: true,
  orderType: true,
  completedAt: true,
} as const;

/** Columns the sold-items query must select for `rankTopItems`. */
export const SOLD_ITEM_SELECT = {
  quantity: true,
  totalPrice: true,
  menuItem: {
    select: { id: true, name: true, category: { select: { name: true } } },
  },
} as const;
