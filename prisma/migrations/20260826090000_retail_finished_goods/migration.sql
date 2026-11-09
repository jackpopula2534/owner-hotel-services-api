-- ต่อของสำเร็จรูปเข้ากับคลังกลาง (Phase 2)
--
-- itemType     = แยกวัตถุดิบออกจากของที่ขายหน้าร้านได้ หน้า "สินค้าหน้าร้าน" กรองด้วยคอลัมน์นี้
-- sellingPrice = ราคาขายแนะนำ ใช้ตั้งราคาเมนูตอนกด "สร้างเป็นเมนู" + คิดกำไรต่อชิ้น
-- warehouseId  = ร้านแต่ละร้านเลือกคลังต้นทางเอง (น้ำขวดที่ lobby bar ไม่ได้มาจากครัว)

ALTER TABLE `inventory_items`
  ADD COLUMN `itemType` ENUM('RAW_MATERIAL', 'FINISHED_GOOD') NOT NULL DEFAULT 'RAW_MATERIAL',
  ADD COLUMN `sellingPrice` DECIMAL(10, 2) NULL;

CREATE INDEX `inventory_items_tenantId_itemType_idx` ON `inventory_items`(`tenantId`, `itemType`);

-- ของที่ถูกเมนูผูกไว้แล้วคือของสำเร็จรูปโดยนิยาม — backfill ก่อนเพื่อให้หน้าใหม่
-- มีข้อมูลตั้งแต่ deploy แรก ไม่ต้องรอให้คนไปกดตั้งค่าทีละตัว
UPDATE `inventory_items` i
SET i.`itemType` = 'FINISHED_GOOD'
WHERE EXISTS (
  SELECT 1 FROM `menu_items` m
  WHERE m.`inventoryItemId` = i.`id`
);

-- ราคาขายแนะนำเอาราคาเมนูที่ผูกอยู่มาเป็นตัวตั้ง (ตัวที่ถูกที่สุดถ้าผูกหลายเมนู)
UPDATE `inventory_items` i
SET i.`sellingPrice` = (
  SELECT MIN(m.`price`) FROM `menu_items` m WHERE m.`inventoryItemId` = i.`id`
)
WHERE i.`itemType` = 'FINISHED_GOOD' AND i.`sellingPrice` IS NULL;

ALTER TABLE `restaurants`
  ADD COLUMN `warehouseId` VARCHAR(191) NULL;

CREATE INDEX `restaurants_warehouseId_idx` ON `restaurants`(`warehouseId`);

ALTER TABLE `restaurants`
  ADD CONSTRAINT `restaurants_warehouseId_fkey`
  FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
