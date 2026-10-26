-- AlterTable
ALTER TABLE `properties`
    ADD COLUMN `map3dConfig` JSON NULL,
    ADD COLUMN `map3dUpdatedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `hotel_map3d_versions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `summary` JSON NOT NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hotel_map3d_versions_tenantId_propertyId_createdAt_idx`(`tenantId`, `propertyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hotel_map3d_versions` ADD CONSTRAINT `hotel_map3d_versions_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
