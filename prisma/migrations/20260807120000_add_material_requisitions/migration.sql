-- CreateTable
CREATE TABLE `material_requisitions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NULL,
    `reqNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('WAITING_STOCK', 'READY', 'ISSUED', 'CANCELLED') NOT NULL DEFAULT 'WAITING_STOCK',
    `mode` ENUM('TRANSFER', 'ISSUE') NOT NULL DEFAULT 'TRANSFER',
    `sourceWarehouseId` VARCHAR(191) NOT NULL,
    `toWarehouseId` VARCHAR(191) NULL,
    `purchaseRequisitionId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `readyAt` DATETIME(3) NULL,
    `issuedBy` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `cancelledBy` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `material_requisitions_tenantId_idx`(`tenantId`),
    INDEX `material_requisitions_status_idx`(`status`),
    INDEX `material_requisitions_sourceWarehouseId_idx`(`sourceWarehouseId`),
    INDEX `material_requisitions_purchaseRequisitionId_idx`(`purchaseRequisitionId`),
    UNIQUE INDEX `material_requisitions_tenantId_reqNumber_key`(`tenantId`, `reqNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_requisition_items` (
    `id` VARCHAR(191) NOT NULL,
    `materialRequisitionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `requiredQty` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
    `shortageQty` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `material_requisition_items_materialRequisitionId_idx`(`materialRequisitionId`),
    INDEX `material_requisition_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `material_requisitions` ADD CONSTRAINT `material_requisitions_purchaseRequisitionId_fkey` FOREIGN KEY (`purchaseRequisitionId`) REFERENCES `purchase_requisitions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_requisition_items` ADD CONSTRAINT `material_requisition_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `material_requisition_items` ADD CONSTRAINT `material_requisition_items_materialRequisitionId_fkey` FOREIGN KEY (`materialRequisitionId`) REFERENCES `material_requisitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
