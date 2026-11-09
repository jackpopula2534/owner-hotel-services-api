import { SettlementType } from '@prisma/client';

/**
 * แปลง "ช่องทางการชำระ" ของแต่ละโมดูลให้เป็นคำเดียวกันในสมุดรายได้
 *
 * สี่ช่องทางรายได้ใช้คำคนละชุดสนิท: POS ร้านอาหารเป็น `CREDIT_CARD`/`QR_PAYMENT`
 * ร้านค้าเป็น enum `CARD`/`QR` การจองห้องเป็นข้อความอิสระ ลานแคมป์เป็น
 * `cash`/`transfer` ตัวพิมพ์เล็ก ถ้าปล่อยให้แต่ละที่แปลงเอง รายงาน "เงินสดรับ"
 * จะนับ QR ของร้านหนึ่งเป็นเงินสดแต่ไม่นับของอีกร้าน แล้วยอดในลิ้นชักจะไม่มีวันตรง
 *
 * ค่าที่ไม่รู้จักตกเป็น CASH เพราะเงินสดคือค่าตั้งต้นของหน้าร้าน แต่เป็นการเดา —
 * ใช้ {@link isKnownPaymentMethod} เช็คก่อนถ้าผู้เรียกต้องรายงานว่าเดาไปกี่แถว
 * (สคริปต์ backfill ใช้ตรงนี้ เพราะข้อมูลเก่ามีค่าอะไรก็ได้ในคอลัมน์ String)
 */
const SETTLEMENT_BY_METHOD: Readonly<Record<string, SettlementType>> = Object.freeze({
  // เงินสด
  cash: SettlementType.CASH,

  // บัตร — เดบิตกับเครดิตเข้าช่องเดียวกัน เพราะทั้งคู่เข้าบัญชีผ่านเครื่อง EDC
  card: SettlementType.CARD,
  credit_card: SettlementType.CARD,
  debit_card: SettlementType.CARD,

  // โอน/สแกน — QR PromptPay คือการโอน ไม่ใช่เงินสดในลิ้นชัก
  qr: SettlementType.TRANSFER,
  qr_payment: SettlementType.TRANSFER,
  qr_code: SettlementType.TRANSFER,
  promptpay: SettlementType.TRANSFER,
  transfer: SettlementType.TRANSFER,
  bank_transfer: SettlementType.TRANSFER,

  // ชาร์จเข้าห้อง — ยังไม่ได้เงิน หนี้ไปอยู่บนบิลห้องพัก
  room_charge: SettlementType.ROOM_CHARGE,
  charged_to_room: SettlementType.ROOM_CHARGE,

  // วางบิล/คูปอง — คนจ่ายไม่ใช่คนกิน เงินตามเก็บทีหลังเหมือนกัน
  voucher: SettlementType.CITY_LEDGER,
  city_ledger: SettlementType.CITY_LEDGER,
  invoice: SettlementType.CITY_LEDGER,
  credit: SettlementType.CITY_LEDGER,
  ota: SettlementType.CITY_LEDGER,
});

const normalize = (method: string | null | undefined): string =>
  (method ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** ช่องทางที่แปลงได้จริง (ไม่ได้ตกเป็นค่าเดา) */
export const isKnownPaymentMethod = (method: string | null | undefined): boolean =>
  normalize(method) in SETTLEMENT_BY_METHOD;

/** ช่องทางการชำระของสมุดรายได้ — ค่าที่ไม่รู้จักตกเป็น CASH */
export const settlementOf = (method: string | null | undefined): SettlementType =>
  SETTLEMENT_BY_METHOD[normalize(method)] ?? SettlementType.CASH;
