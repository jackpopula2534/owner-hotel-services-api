-- AlterTable
ALTER TABLE `camp_addons` ADD COLUMN `inventoryItemId` VARCHAR(36) NULL;

-- AlterTable
ALTER TABLE `camp_grounds` ADD COLUMN `warehouseId` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `camp_requisitions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `requisitionNo` VARCHAR(30) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'transfer',
    `sourceWarehouseId` VARCHAR(36) NOT NULL,
    `destWarehouseId` VARCHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `notes` TEXT NULL,
    `createdBy` VARCHAR(36) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `camp_requisitions_tenantId_idx`(`tenantId`),
    INDEX `camp_requisitions_campgroundId_idx`(`campgroundId`),
    INDEX `camp_requisitions_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_requisition_items` (
    `id` VARCHAR(36) NOT NULL,
    `requisitionId` VARCHAR(36) NOT NULL,
    `inventoryItemId` VARCHAR(36) NOT NULL,
    `addonId` VARCHAR(36) NULL,
    `name` VARCHAR(180) NOT NULL,
    `sku` VARCHAR(60) NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `unitCost` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `camp_requisition_items_requisitionId_idx`(`requisitionId`),
    INDEX `camp_requisition_items_inventoryItemId_idx`(`inventoryItemId`),
    INDEX `camp_requisition_items_addonId_idx`(`addonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `camp_addons_inventoryItemId_idx` ON `camp_addons`(`inventoryItemId`);

-- AddForeignKey
ALTER TABLE `camp_requisitions` ADD CONSTRAINT `camp_requisitions_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `camp_requisition_items` ADD CONSTRAINT `camp_requisition_items_requisitionId_fkey` FOREIGN KEY (`requisitionId`) REFERENCES `camp_requisitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `camp_requisition_items` ADD CONSTRAINT `camp_requisition_items_addonId_fkey` FOREIGN KEY (`addonId`) REFERENCES `camp_addons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
