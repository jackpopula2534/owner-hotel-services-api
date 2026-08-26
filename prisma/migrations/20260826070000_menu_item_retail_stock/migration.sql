-- ขายสินค้าสำเร็จรูปผ่าน POS โดยไม่ต้องมี add-on คลัง (Phase 1)
--
-- itemKind  = ตัวเดียวที่ตัดสินว่ารายการนี้ขึ้นจอครัวไหม (แยกจากการนับสต๊อก)
-- trackStock/stockQty = โหมด LOCAL นับสต๊อกในตัวเมนูเอง สำหรับ tenant ที่ไม่มี
--             INVENTORY_MODULE — ห้ามเปิดพร้อม inventoryItemId (สองแหล่งความจริง)

ALTER TABLE `menu_items`
  ADD COLUMN `itemKind` ENUM('COOKED', 'READY_MADE') NOT NULL DEFAULT 'COOKED',
  ADD COLUMN `trackStock` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `stockQty` INT NOT NULL DEFAULT 0,
  ADD COLUMN `lowStockThreshold` INT NULL;

CREATE INDEX `menu_items_itemKind_idx` ON `menu_items`(`itemKind`);

-- เมนูที่ผูกคลังกลางไว้แล้วคือสินค้าสำเร็จรูปโดยนิยาม — ไม่ควรไปรอเชฟกด ready
UPDATE `menu_items` SET `itemKind` = 'READY_MADE' WHERE `inventoryItemId` IS NOT NULL;

-- สมุดเข้า-ออกของโหมด LOCAL: เก็บแค่ตัวเลข stockQty ลอย ๆ จะตรวจย้อนไม่ได้ว่าของหายตรงไหน
CREATE TABLE `menu_item_stock_movements` (
  `id`            VARCHAR(191) NOT NULL,
  `tenantId`      VARCHAR(191) NOT NULL,
  `menuItemId`    VARCHAR(191) NOT NULL,
  `type`          ENUM('OPENING', 'RECEIVE', 'SALE', 'ADJUST', 'WASTE', 'RETURN') NOT NULL,
  `quantity`      INT NOT NULL,
  `balanceAfter`  INT NOT NULL,
  `unitCost`      DECIMAL(10, 2) NULL,
  `referenceType` VARCHAR(191) NULL,
  `referenceId`   VARCHAR(191) NULL,
  `note`          TEXT NULL,
  `createdBy`     VARCHAR(191) NULL,
  `createdAt`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `menu_item_stock_movements_tenantId_idx`(`tenantId`),
  INDEX `menu_item_stock_movements_menuItemId_createdAt_idx`(`menuItemId`, `createdAt`),
  INDEX `menu_item_stock_movements_referenceType_referenceId_idx`(`referenceType`, `referenceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `menu_item_stock_movements`
  ADD CONSTRAINT `menu_item_stock_movements_menuItemId_fkey`
  FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
