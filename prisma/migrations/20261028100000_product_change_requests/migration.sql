-- Product change requests: procurement proposes new items / edits to the data it owns,
-- the warehouse approves (or acknowledges) before anything reaches inventory_items.

-- AlterTable: purchase unit owned by procurement (changes need warehouse approval)
ALTER TABLE `inventory_items`
    ADD COLUMN `purchaseUnit` ENUM('PIECE', 'BOX', 'PACK', 'KG', 'G', 'L', 'ML', 'BOTTLE', 'CAN', 'BAG', 'ROLL', 'SET', 'PAIR', 'SHEET', 'METER', 'DOZEN') NULL,
    ADD COLUMN `purchaseUnitFactor` DECIMAL(10, 3) NULL;

-- CreateTable
CREATE TABLE `product_change_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `requestNumber` VARCHAR(191) NOT NULL,
    `type` ENUM('CREATE', 'UPDATE') NOT NULL,
    `status` ENUM('PENDING', 'NEEDS_INFO', 'APPROVED', 'ACKNOWLEDGED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `level` ENUM('ACKNOWLEDGE', 'APPROVAL') NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `proposed` JSON NOT NULL,
    `baseline` JSON NULL,
    `changes` JSON NULL,
    `suggestedWarehouse` JSON NULL,
    `warehouseData` JSON NULL,
    `reason` TEXT NULL,
    `prReference` VARCHAR(191) NULL,
    `neededBy` DATETIME(3) NULL,
    `effectiveDate` DATETIME(3) NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedByName` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedByName` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `duplicateOfItemId` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_change_requests_tenantId_requestNumber_key`(`tenantId`, `requestNumber`),
    INDEX `product_change_requests_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `product_change_requests_tenantId_type_idx`(`tenantId`, `type`),
    INDEX `product_change_requests_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_change_request_events` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `product_change_request_events_requestId_idx`(`requestId`),
    INDEX `product_change_request_events_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_change_requests` ADD CONSTRAINT `product_change_requests_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_change_request_events` ADD CONSTRAINT `product_change_request_events_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `product_change_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
