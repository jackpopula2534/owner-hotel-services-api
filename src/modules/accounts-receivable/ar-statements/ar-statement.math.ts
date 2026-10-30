import { DAY_MS, round2 } from '@/common/utils/bangkok-day.util';

/**
 * คณิตของใบแจ้งยอด (Statement) ลูกค้า — แยกเป็นฟังก์ชันบริสุทธิ์เพื่อเทสต์ได้โดยไม่แตะ DB
 *
 * วันที่ทุกตัวเป็น 'YYYY-MM-DD' (มาจากคอลัมน์ @db.Date = UTC midnight) เทียบกันเป็นสตริงตรง ๆ
 * ห้ามแปลงผ่านนาฬิกาเครื่อง ไม่งั้นวันเพี้ยน 1 วัน
 */

export type StatementLineType = 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';

export interface StatementInvoiceInput {
  id: string;
  invoiceNo: string;
  invoiceType: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  balance: number;
  status: string;
  /** ใบลดหนี้ → เลขใบแจ้งหนี้ต้นทาง */
  refInvoiceNo?: string | null;
  notes?: string | null;
}

export interface StatementReceiptInput {
  id: string;
  receiptNo: string;
  receiptDate: string;
  method: string;
  reference?: string | null;
  /** เงินที่รับจริง */
  totalAmount: number;
  /** ภาษีที่ลูกค้าหัก ณ ที่จ่าย — นับเป็นยอดตัดหนี้ด้วย */
  whtAmount: number;
  /** ยอดที่ตัดเข้าใบแจ้งหนี้ของลูกค้ารายนี้ */
  allocations: { invoiceNo: string; amount: number }[];
}

export interface StatementLine {
  date: string;
  type: StatementLineType;
  docId: string;
  docNo: string;
  description: string;
  dueDate: string | null;
  refDocNo: string | null;
  debit: number;
  credit: number;
  /** เฉพาะใบเสร็จ: ส่วนที่เป็นเงินรับจริง / ส่วนที่เป็นภาษีหัก ณ ที่จ่าย */
  cashAmount?: number;
  whtAmount?: number;
  balance: number;
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

export interface AgingInvoice {
  id: string;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  totalAmount: number;
  balance: number;
  daysOverdue: number;
  bucket: keyof Omit<AgingBuckets, 'total'>;
}

const TYPE_ORDER: Record<StatementLineType, number> = { INVOICE: 0, CREDIT_NOTE: 1, RECEIPT: 2 };

const METHOD_LABEL: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  CREDIT_CARD: 'บัตรเครดิต',
  DEBIT_CARD: 'บัตรเดบิต',
  QR_PROMPTPAY: 'PromptPay',
  TRUEMONEY: 'TrueMoney',
  CHEQUE: 'เช็ค',
  CREDIT_NOTE: 'ใบลดหนี้',
  ADVANCE: 'ตัดมัดจำ',
  CITY_LEDGER: 'City Ledger',
  ONLINE_BOOKING: 'OTA',
  OTHER: 'อื่น ๆ',
};

/** จำนวนวันระหว่าง 'YYYY-MM-DD' สองวัน (b − a) */
export const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / DAY_MS,
  );

/** แปลงใบแจ้งหนี้/ใบลดหนี้/ใบเสร็จ เป็นรายการเดินบัญชี (ยังไม่มียอดคงเหลือ) */
export function toStatementEntries(
  invoices: StatementInvoiceInput[],
  receipts: StatementReceiptInput[],
): Omit<StatementLine, 'balance'>[] {
  const entries: Omit<StatementLine, 'balance'>[] = [];

  for (const inv of invoices) {
    if (inv.invoiceType === 'CREDIT_NOTE') {
      // ใบลดหนี้เก็บยอดเป็นบวกหรือลบก็ได้ → ลงฝั่งเครดิตเสมอ
      entries.push({
        date: inv.issueDate,
        type: 'CREDIT_NOTE',
        docId: inv.id,
        docNo: inv.invoiceNo,
        description: inv.refInvoiceNo ? `ใบลดหนี้ อ้างอิง ${inv.refInvoiceNo}` : 'ใบลดหนี้',
        dueDate: null,
        refDocNo: inv.refInvoiceNo ?? null,
        debit: 0,
        credit: round2(Math.abs(inv.totalAmount)),
      });
      continue;
    }
    entries.push({
      date: inv.issueDate,
      type: 'INVOICE',
      docId: inv.id,
      docNo: inv.invoiceNo,
      description: inv.invoiceType === 'ADVANCE_DEPOSIT' ? 'ใบแจ้งหนี้มัดจำ' : 'ใบแจ้งหนี้',
      dueDate: inv.dueDate,
      refDocNo: null,
      debit: round2(inv.totalAmount),
      credit: 0,
    });
  }

  for (const r of receipts) {
    const settled = round2(r.allocations.reduce((s, a) => s + a.amount, 0));
    if (settled <= 0) continue;
    // ยอดตัดหนี้ = เงินรับ + ภาษีหัก ณ ที่จ่าย → แยกส่วน WHT ออกมาแสดง (ไม่เกินยอดที่ตัด)
    const wht = round2(Math.min(Math.max(r.whtAmount, 0), settled));
    const invoiceNos = r.allocations.map((a) => a.invoiceNo).join(', ');
    const method = METHOD_LABEL[r.method] ?? r.method;
    entries.push({
      date: r.receiptDate,
      type: 'RECEIPT',
      docId: r.id,
      docNo: r.receiptNo,
      description: `รับชำระ (${method})${r.reference ? ` ${r.reference}` : ''}${
        wht > 0 ? ' รวมภาษีหัก ณ ที่จ่าย' : ''
      }`,
      dueDate: null,
      refDocNo: invoiceNos || null,
      debit: 0,
      credit: settled,
      cashAmount: round2(settled - wht),
      whtAmount: wht,
    });
  }

  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.docNo.localeCompare(b.docNo),
  );
}

/**
 * ยอดยกมา + รายการในช่วง + ยอดคงเหลือสะสม
 * รายการก่อน dateFrom รวมเป็นยอดยกมา; รายการหลัง dateTo ตัดทิ้ง
 */
export function buildStatement(
  entries: Omit<StatementLine, 'balance'>[],
  dateFrom: string,
  dateTo: string,
): {
  openingBalance: number;
  lines: StatementLine[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
} {
  let opening = 0;
  const inRange: Omit<StatementLine, 'balance'>[] = [];
  for (const e of entries) {
    if (e.date < dateFrom) opening = round2(opening + e.debit - e.credit);
    else if (e.date <= dateTo) inRange.push(e);
  }

  let running = opening;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = inRange.map((e) => {
    running = round2(running + e.debit - e.credit);
    totalDebit = round2(totalDebit + e.debit);
    totalCredit = round2(totalCredit + e.credit);
    return { ...e, balance: running };
  });

  return { openingBalance: opening, lines, totalDebit, totalCredit, closingBalance: running };
}

/** อายุหนี้ของใบที่ยังค้าง (ใช้ balance ปัจจุบัน) นับวันเกินกำหนดจาก dueDate ถึง asOf */
export function buildAging(
  invoices: StatementInvoiceInput[],
  asOf: string,
): { buckets: AgingBuckets; invoices: AgingInvoice[] } {
  const buckets: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  const open: AgingInvoice[] = [];

  for (const inv of invoices) {
    if (inv.invoiceType === 'CREDIT_NOTE') continue;
    if (!['ISSUED', 'PARTIAL', 'OVERDUE'].includes(inv.status)) continue;
    if (inv.balance <= 0.005) continue;

    const daysOverdue = Math.max(0, daysBetween(inv.dueDate, asOf));
    const bucket: AgingInvoice['bucket'] =
      daysOverdue <= 0
        ? 'current'
        : daysOverdue <= 30
          ? 'd1_30'
          : daysOverdue <= 60
            ? 'd31_60'
            : daysOverdue <= 90
              ? 'd61_90'
              : 'd90plus';
    buckets[bucket] = round2(buckets[bucket] + inv.balance);
    buckets.total = round2(buckets.total + inv.balance);
    open.push({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      totalAmount: inv.totalAmount,
      balance: inv.balance,
      daysOverdue,
      bucket,
    });
  }

  open.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceNo.localeCompare(b.invoiceNo));
  return { buckets, invoices: open };
}
