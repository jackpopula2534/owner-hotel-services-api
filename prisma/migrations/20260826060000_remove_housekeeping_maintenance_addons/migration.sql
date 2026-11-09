-- งานแม่บ้านและงานแจ้งซ่อมเป็นความสามารถของ HR_MODULE ไม่ใช่ add-on ที่ขายแยกอีกต่อไป
--
-- `HOUSEKEEPING_MANAGEMENT` ถูก INSERT ไว้ใน migration 20260501130000 จึงต้องลบด้วย
-- migration (แก้ seeder อย่างเดียวไม่พอ — db:refresh จะสร้างกลับมาทุกครั้ง)
-- ส่วน HOUSEKEEPING_MODULE / MAINTENANCE_MODULE มาจาก seeder ที่ถอดออกแล้ว ใส่ไว้
-- ด้วยเพื่อเก็บกวาดฐานข้อมูลที่ seed ด้วยโค้ดรุ่นเก่า

DELETE sf FROM `subscription_features` sf
  JOIN `add_ons` a ON a.`id` = sf.`feature_id`
  WHERE a.`code` IN ('HOUSEKEEPING_MANAGEMENT', 'HOUSEKEEPING_MODULE', 'MAINTENANCE_MODULE');

DELETE pa FROM `plan_addons` pa
  JOIN `add_ons` a ON a.`id` = pa.`addon_id`
  WHERE a.`code` IN ('HOUSEKEEPING_MANAGEMENT', 'HOUSEKEEPING_MODULE', 'MAINTENANCE_MODULE');

DELETE FROM `add_ons`
  WHERE `code` IN ('HOUSEKEEPING_MANAGEMENT', 'HOUSEKEEPING_MODULE', 'MAINTENANCE_MODULE');
