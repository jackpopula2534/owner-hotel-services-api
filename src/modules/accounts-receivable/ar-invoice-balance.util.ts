import { ArInvoiceStatus } from '@prisma/client';

const round2 = (v: number): number => Math.round(v * 100) / 100;

interface InvoiceAmounts {
  status: ArInvoiceStatus | string;
  totalAmount: unknown;
  paidAmount: unknown;
  creditedAmount: unknown;
}

export interface InvoiceSettlement {
  paidAmount: number;
  creditedAmount: number;
  balance: number;
  status: ArInvoiceStatus;
}

/**
 * ยอดคงค้างใบแจ้งหนี้ = ยอดรวม − รับชำระ − ลดหนี้
 * ทุกจุดที่ตัด/คืนยอด (รับชำระ, จัดสรรภายหลัง, ใบลดหนี้, ยกเลิก) ต้องผ่านตัวนี้
 * ห้ามคิด balance = total − paid เอง ไม่งั้นใบลดหนี้ที่ตัดไปแล้วหายเงียบ ๆ
 */
export function settleInvoice(
  invoice: InvoiceAmounts,
  delta: { paid?: number; credited?: number },
): InvoiceSettlement {
  const total = Number(invoice.totalAmount);
  const paidAmount = Math.max(0, round2(Number(invoice.paidAmount) + (delta.paid ?? 0)));
  const creditedAmount = Math.max(
    0,
    round2(Number(invoice.creditedAmount ?? 0) + (delta.credited ?? 0)),
  );
  const balance = Math.max(0, round2(total - paidAmount - creditedAmount));

  let status: ArInvoiceStatus;
  if (invoice.status === 'VOID') status = 'VOID';
  else if (balance <= 0.01) status = 'PAID';
  else if (paidAmount + creditedAmount > 0) status = 'PARTIAL';
  else status = invoice.status === 'OVERDUE' ? 'OVERDUE' : 'ISSUED';

  return { paidAmount, creditedAmount, balance, status };
}
