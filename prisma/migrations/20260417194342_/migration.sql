-- AlterTable
ALTER TABLE `goods_receive_items` ADD COLUMN `lotId` VARCHAR(191) NULL,
    ADD COLUMN `qcRecordId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `defaultQCTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `requiresLotTracking` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requiresQC` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `stock_movements` ADD COLUMN `lotId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `suppliers` MODIFY `emoji` VARCHAR(191) NULL DEFAULT '🏢';

-- CreateTable
CREATE TABLE `inventory_lots` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `lotNumber` VARCHAR(191) NOT NULL,
    `batchNumber` VARCHAR(191) NULL,
    `grItemId` VARCHAR(191) NULL,
    `supplierId` VARCHAR(191) NULL,
    `receivedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `manufactureDate` DATETIME(3) NULL,
    `expiryDate` DATETIME(3) NULL,
    `initialQty` INTEGER NOT NULL,
    `remainingQty` INTEGER NOT NULL,
    `unitCost` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'QUARANTINED', 'EXHAUSTED', 'EXPIRED', 'DISPOSED') NOT NULL DEFAULT 'ACTIVE',
    `qrPayload` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `inventory_lots_tenantId_itemId_warehouseId_status_idx`(`tenantId`, `itemId`, `warehouseId`, `status`),
    INDEX `inventory_lots_expiryDate_idx`(`expiryDate`),
    INDEX `inventory_lots_grItemId_idx`(`grItemId`),
    UNIQUE INDEX `inventory_lots_tenantId_lotNumber_key`(`tenantId`, `lotNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `appliesTo` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `itemId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `qc_templates_tenantId_appliesTo_idx`(`tenantId`, `appliesTo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_checklist_items` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `passCondition` JSON NULL,
    `orderIndex` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `qc_checklist_items_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `goodsReceiveId` VARCHAR(191) NULL,
    `lotId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'PASSED', 'PARTIAL_FAIL', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `inspectedBy` VARCHAR(191) NOT NULL,
    `inspectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `qc_records_tenantId_idx`(`tenantId`),
    INDEX `qc_records_goodsReceiveId_idx`(`goodsReceiveId`),
    INDEX `qc_records_lotId_idx`(`lotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_results` (
    `id` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `checklistItemId` VARCHAR(191) NOT NULL,
    `valueBool` BOOLEAN NULL,
    `valueNumeric` DECIMAL(10, 2) NULL,
    `valueText` TEXT NULL,
    `photoUrls` JSON NULL,
    `passed` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `qc_results_recordId_idx`(`recordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `goods_receive_items_lotId_idx` ON `goods_receive_items`(`lotId`);

-- CreateIndex
CREATE INDEX `stock_movements_lotId_idx` ON `stock_movements`(`lotId`);

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_lots` ADD CONSTRAINT `inventory_lots_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_lots` ADD CONSTRAINT `inventory_lots_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_checklist_items` ADD CONSTRAINT `qc_checklist_items_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `qc_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_records` ADD CONSTRAINT `qc_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `qc_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_records` ADD CONSTRAINT `qc_records_lotId_fkey` FOREIGN KEY (`lotId`) REFERENCES `inventory_lots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_results` ADD CONSTRAINT `qc_results_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `qc_records`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `qc_results` ADD CONSTRAINT `qc_results_checklistItemId_fkey` FOREIGN KEY (`checklistItemId`) REFERENCES `qc_checklist_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
