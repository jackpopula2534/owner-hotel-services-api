-- CreateTable
CREATE TABLE `staff_calls` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `restaurantId` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `callType` ENUM('SERVICE', 'PAYMENT', 'WATER', 'ASSISTANCE', 'CLEANUP', 'CUSTOM') NOT NULL DEFAULT 'SERVICE',
    `status` ENUM('PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `source` ENUM('CUSTOMER', 'POS') NOT NULL DEFAULT 'CUSTOMER',
    `message` TEXT NULL,
    `customerName` VARCHAR(191) NULL,
    `assignedToId` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolution` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `staff_calls_tenantId_idx`(`tenantId`),
    INDEX `staff_calls_restaurantId_idx`(`restaurantId`),
    INDEX `staff_calls_tableId_idx`(`tableId`),
    INDEX `staff_calls_status_idx`(`status`),
    INDEX `staff_calls_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `staff_calls` ADD CONSTRAINT `staff_calls_restaurantId_fkey` FOREIGN KEY (`restaurantId`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_calls` ADD CONSTRAINT `staff_calls_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `restaurant_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
