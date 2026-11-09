-- เพิ่มฟิลด์โครงสร้างอุปกรณ์แบบมืออาชีพ + รองรับรูปภาพหลายรูป
ALTER TABLE `camp_addons`
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `unit` VARCHAR(20) NOT NULL DEFAULT 'ชิ้น',
  ADD COLUMN `deposit` DECIMAL(10, 2) NULL,
  ADD COLUMN `images` JSON NULL;
