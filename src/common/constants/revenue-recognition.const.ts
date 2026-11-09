import { OrderPaymentStatus } from '@prisma/client';

/**
 * Revenue is recognized when the bill closes, not when the cash arrives.
 *
 * A bill signed to a guest's room (`CHARGED_TO_ROOM`) is revenue the moment it
 * closes — the folio holds the receivable and collects it at checkout. Reports
 * that filter on `PAID` alone silently drop every room charge, which is how the
 * restaurant's takings and the hotel's books stopped agreeing.
 *
 * Use {@link RECOGNIZED_ORDER_PAYMENT_STATUSES} for anything labelled "รายได้"
 * and {@link CASH_COLLECTED_ORDER_PAYMENT_STATUSES} for anything labelled
 * "เงินสดรับ" / drawer reconciliation. They are deliberately different numbers.
 */
export const RECOGNIZED_ORDER_PAYMENT_STATUSES: OrderPaymentStatus[] = [
  OrderPaymentStatus.PAID,
  OrderPaymentStatus.CHARGED_TO_ROOM,
];

/** Bills where money actually crossed the counter. */
export const CASH_COLLECTED_ORDER_PAYMENT_STATUSES: OrderPaymentStatus[] = [
  OrderPaymentStatus.PAID,
];

/** True when the bill is closed and its revenue should be counted. */
export function isRecognizedOrderPayment(status: string): boolean {
  return (RECOGNIZED_ORDER_PAYMENT_STATUSES as string[]).includes(status);
}

/**
 * สถานะการเข้าพักที่ถือว่าจบแล้วและรับรู้รายได้ได้
 *
 * `checked_out` คือสถานะที่ `BookingsService.checkOut` เขียน แต่ข้อมูลที่มีอยู่ก่อน
 * หน้านั้น (และที่ seeder สร้าง) ใช้คำว่า `completed` สำหรับการเข้าพักที่จบแล้ว
 * เหมือนกัน — `ReportsService` นับสองคำนี้รวมกันมาตลอด ถ้าสมุดรายได้นับแค่
 * `checked_out` การเข้าพักเก่าทั้งหมดจะหายจากรายงานตอนสลับไปอ่านจากสมุด
 *
 * ใช้กับการจองห้องพักและการจองลานกางเต็นท์ — ทั้งสองโมดูลเก็บสถานะเป็น string
 * ชุดเดียวกัน
 */
export const RECOGNIZED_STAY_STATUSES: string[] = ['checked_out', 'completed'];
