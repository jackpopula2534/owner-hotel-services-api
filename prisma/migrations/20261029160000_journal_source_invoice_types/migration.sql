-- ใบแจ้งหนี้ AR/AP เคยลงสมุดรายวันด้วย sourceType ของ "การรับ/จ่ายเงิน" (AR_RECEIPT / AP_PAYMENT)
-- พอจะเริ่มลงบัญชีตอนรับชำระ/จ่ายชำระจริง ป้ายเดียวกันจะแยกไม่ออกว่าใบไหนเป็นตั้งหนี้ ใบไหนเป็นตัดหนี้
-- จึงเพิ่มชนิดของใบแจ้งหนี้ + POS_SALE (ยอดขายร้านอาหาร) แล้วย้ายป้ายของรายการเดิมให้ถูก

-- AlterEnum
ALTER TABLE `journal_entries`
  MODIFY `sourceType` ENUM(
    'MANUAL',
    'BOOKING_PAYMENT',
    'CAMP_PAYMENT',
    'FOLIO_CHARGE',
    'AR_INVOICE',
    'AR_RECEIPT',
    'AP_INVOICE',
    'AP_PAYMENT',
    'POS_SALE',
    'NIGHT_AUDIT',
    'DEPRECIATION',
    'PAYROLL',
    'PURCHASE_RECEIPT',
    'TAX_FILING',
    'CLOSING_ENTRY',
    'ADJUSTMENT'
  ) NOT NULL DEFAULT 'MANUAL';

-- Relabel entries that were posted for invoices
UPDATE `journal_entries` je
  JOIN `ar_invoices` ai ON ai.`id` = je.`sourceId`
  SET je.`sourceType` = 'AR_INVOICE'
  WHERE je.`sourceType` = 'AR_RECEIPT';

UPDATE `journal_entries` je
  JOIN `ap_invoices` ap ON ap.`id` = je.`sourceId`
  SET je.`sourceType` = 'AP_INVOICE'
  WHERE je.`sourceType` = 'AP_PAYMENT';
