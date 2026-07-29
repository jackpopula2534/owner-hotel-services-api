-- รับชำระของลานกางเต็นท์ (camp_reservations) ต้องลงบัญชีได้เหมือนการจองห้องพัก
-- เดิม JournalSourceType ไม่มีค่าสำหรับ camp เลย รายได้ลานจึงไม่เคยเข้าสมุดรายวัน

-- AlterEnum
ALTER TABLE `journal_entries`
  MODIFY `sourceType` ENUM(
    'MANUAL',
    'BOOKING_PAYMENT',
    'CAMP_PAYMENT',
    'FOLIO_CHARGE',
    'AR_RECEIPT',
    'AP_PAYMENT',
    'NIGHT_AUDIT',
    'DEPRECIATION',
    'PAYROLL',
    'PURCHASE_RECEIPT',
    'TAX_FILING',
    'CLOSING_ENTRY',
    'ADJUSTMENT'
  ) NOT NULL DEFAULT 'MANUAL';
