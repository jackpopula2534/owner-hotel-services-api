-- AlterTable
ALTER TABLE `camp_grounds` ADD COLUMN `map3dConfig` JSON NULL,
    ADD COLUMN `map3dUpdatedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `camp_map_extractions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `imageWidth` INTEGER NOT NULL,
    `imageHeight` INTEGER NOT NULL,
    `input` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `step` VARCHAR(20) NULL,
    `result` JSON NULL,
    `reservationId` VARCHAR(36) NULL,
    `errorCode` VARCHAR(60) NULL,
    `errorMessage` VARCHAR(255) NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `camp_map_extractions_tenantId_campgroundId_createdAt_idx`(`tenantId`, `campgroundId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_map_extractions` ADD CONSTRAINT `camp_map_extractions_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
