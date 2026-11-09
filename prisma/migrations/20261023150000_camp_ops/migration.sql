-- AlterTable
ALTER TABLE `camp_reservations`
    ADD COLUMN `extraCharges` JSON NULL,
    ADD COLUMN `vehiclePlate` VARCHAR(30) NULL,
    ADD COLUMN `idVerifiedAt` DATETIME(3) NULL,
    ADD COLUMN `cancelReason` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `camp_ops_tasks` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `pitchId` VARCHAR(36) NULL,
    `facilityId` VARCHAR(36) NULL,
    `reservationId` VARCHAR(36) NULL,
    `type` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `title` VARCHAR(180) NOT NULL,
    `priority` VARCHAR(10) NOT NULL DEFAULT 'normal',
    `assigneeName` VARCHAR(120) NULL,
    `blocksPitch` BOOLEAN NOT NULL DEFAULT false,
    `cost` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(36) NULL,
    `completedBy` VARCHAR(36) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `camp_ops_tasks_tenantId_campgroundId_status_idx`(`tenantId`, `campgroundId`, `status`),
    INDEX `camp_ops_tasks_pitchId_idx`(`pitchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `camp_ops_events` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `campgroundId` VARCHAR(36) NOT NULL,
    `pitchId` VARCHAR(36) NULL,
    `reservationId` VARCHAR(36) NULL,
    `type` VARCHAR(40) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `actorId` VARCHAR(36) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `camp_ops_events_tenantId_campgroundId_createdAt_idx`(`tenantId`, `campgroundId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `camp_ops_tasks` ADD CONSTRAINT `camp_ops_tasks_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `camp_ops_events` ADD CONSTRAINT `camp_ops_events_campgroundId_fkey` FOREIGN KEY (`campgroundId`) REFERENCES `camp_grounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
