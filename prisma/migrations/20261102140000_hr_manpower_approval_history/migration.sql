-- ประวัติการอนุมัติ/ส่งกลับ/ยื่นใหม่ พร้อมไฟล์แนบ (approvalChain ถูก reset ทุกครั้งที่ยื่นใหม่ จึงต้องเก็บแยก)
ALTER TABLE `hr_manpower_requests` ADD COLUMN `approvalHistory` JSON NULL;
