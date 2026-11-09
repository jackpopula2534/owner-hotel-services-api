-- Camp Sub-System Phase 2: add-on rental (catalog + stock + reservation line items)

-- CreateTable
CREATE TABLE `camp_addons` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `category` VARCHAR(20) NOT NULL DEFAULT 'other',
    `pricePerUnit` DECIMAL(10, 2) NOT NULL,
    `stockQty` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `camp_addons_tenantId_idx`(`tenantId`),
    INDEX `camp_addons_campgroundId_idx`(`campgroundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_reservation_addons` (
    `id` VARCHAR(36) NOT NULL,
    `reservationId` VARCHAR(36) NOT NULL,
    `addonId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `qty` INTEGER NOT NULL DEFAULT 1,
    `priceSnapshot` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `camp_reservation_addons_reservationId_idx`(`reservationId`),
    INDEX `camp_reservation_addons_addonId_idx`(`addonId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_addons` ADD CONSTRAINT `camp_addons_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_reservation_addons` ADD CONSTRAINT `camp_reservation_addons_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `camp_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `camp_reservation_addons` ADD CONSTRAINT `camp_reservation_addons_addonId_fkey` FOREIGN KEY (`addonId`) REFERENCES `camp_addons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
