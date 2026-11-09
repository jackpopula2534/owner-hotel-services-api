-- ประวัติการผูกเมนูกับสินค้าในคลัง (ผูก / เปลี่ยน / ถอด) พร้อมเหตุผลและผู้ทำรายการ
CREATE TABLE `menu_item_inventory_link_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `menuItemId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromInventoryItemId` VARCHAR(191) NULL,
    `fromItemName` VARCHAR(191) NULL,
    `fromItemSku` VARCHAR(191) NULL,
    `toInventoryItemId` VARCHAR(191) NULL,
    `toItemName` VARCHAR(191) NULL,
    `toItemSku` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `note` TEXT NULL,
    `changedById` VARCHAR(191) NULL,
    `changedByName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `menu_link_logs_tenant_item_created_idx`(`tenantId`, `menuItemId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
