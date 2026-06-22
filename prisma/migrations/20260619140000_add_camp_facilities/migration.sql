-- Camp Sub-System: facilities (service points on campground map)

-- CreateTable
CREATE TABLE `camp_facilities` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `type` VARCHAR(30) NOT NULL DEFAULT 'restroom',
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `posX` DOUBLE NOT NULL DEFAULT 0.5,
    `posY` DOUBLE NOT NULL DEFAULT 0.5,
    `openingTime` VARCHAR(10) NULL,
    `closingTime` VARCHAR(10) NULL,
    `open24h` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `camp_facilities_tenantId_idx`(`tenantId`),
    INDEX `camp_facilities_campgroundId_idx`(`campgroundId`),
    INDEX `camp_facilities_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_facilities` ADD CONSTRAINT `camp_facilities_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
