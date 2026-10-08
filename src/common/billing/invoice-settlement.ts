/**
 * ใบแจ้งหนี้ของการจองปิดเป็น paid ได้เมื่อยอดที่อนุมัติแล้วครอบคลุมยอดรวมเท่านั้น
 * — มัดจำ PromptPay จากหน้าเว็บต้องไม่ทำให้ใบแจ้งหนี้กลายเป็น "ชำระแล้ว" ทั้งที่ยังค้างส่วนที่เหลือ
 *
 * payments.amount = null คือแถวรุ่นเก่าที่ไม่บันทึกยอด (เดิมถือเป็นยอดเต็มของใบแจ้งหนี้) → ถือว่าครบ
 */
export function isInvoiceSettled(
  invoice: { amount: unknown; adjusted_amount?: unknown },
  approvedPayments: Array<{ amount: unknown }>,
): boolean {
  if (approvedPayments.some((p) => p.amount === null || p.amount === undefined)) return true;
  const total = Number(invoice.adjusted_amount ?? invoice.amount ?? 0) || 0;
  const paid = approvedPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  // ปัดเป็นสตางค์ กันเศษทศนิยมลอยตัว
  return Math.round(paid * 100) >= Math.round(total * 100);
}
