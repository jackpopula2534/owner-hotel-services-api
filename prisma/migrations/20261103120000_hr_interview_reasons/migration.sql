-- เหตุผลเมื่อไม่ผ่าน / เลื่อน / ยกเลิก / ไม่มาสัมภาษณ์ / ถอนตัว
ALTER TABLE `hr_interviews`
  ADD COLUMN `resultReason` TEXT NULL,
  ADD COLUMN `statusReason` TEXT NULL;

ALTER TABLE `hr_candidates` ADD COLUMN `statusReason` TEXT NULL;
