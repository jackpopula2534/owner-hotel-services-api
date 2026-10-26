-- CreateTable
CREATE TABLE `camp_map3d_versions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `config` JSON NOT NULL,
    `summary` JSON NOT NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `camp_map3d_versions_tenantId_campgroundId_createdAt_idx`(`tenantId`, `campgroundId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_map3d_versions` ADD CONSTRAINT `camp_map3d_versions_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
