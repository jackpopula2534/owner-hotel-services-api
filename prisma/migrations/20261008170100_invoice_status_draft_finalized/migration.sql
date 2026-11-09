-- schema มี draft / finalized มานานแล้วแต่ไม่เคยมี migration → guest folio เขียน 'draft' / 'finalized'
-- (ปิด folio ที่ยังค้างยอด เช่นจ่ายแค่มัดจำ) แล้ว MySQL ปฏิเสธ
ALTER TABLE `invoices` MODIFY `status` ENUM('pending', 'draft', 'finalized', 'paid', 'rejected', 'voided') NOT NULL DEFAULT 'pending';
