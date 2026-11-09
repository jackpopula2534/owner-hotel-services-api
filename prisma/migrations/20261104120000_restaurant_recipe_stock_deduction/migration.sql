-- ตัดวัตถุดิบตามสูตรรายร้าน: NULL = ตามสวิตช์ Integration Hub ของกิจการ
ALTER TABLE `restaurants` ADD COLUMN `recipeStockDeduction` BOOLEAN NULL;
