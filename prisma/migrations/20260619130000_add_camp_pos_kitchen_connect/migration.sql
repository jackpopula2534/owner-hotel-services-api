-- เพิ่ม state การเชื่อมต่อระบบ POS และระบบครัว (KDS) แยกตามแต่ละลาน
-- null = ยังไม่กดเชื่อมต่อ, มีค่า = เวลาที่กดเชื่อมต่อ (กดเชื่อม/ยกเลิกเองต่อลาน)
ALTER TABLE `camp_grounds`
  ADD COLUMN `posConnectedAt` DATETIME(3) NULL,
  ADD COLUMN `kitchenConnectedAt` DATETIME(3) NULL;
