-- ประวัติการเปลี่ยนสถานะงานแม่บ้าน (ใคร / จากอะไร→อะไร / เมื่อไหร่ / เหตุผลที่ย้อน)
CREATE TABLE `housekeeping_task_status_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NOT NULL,
    `toStatus` VARCHAR(191) NOT NULL,
    `roomStatusBefore` VARCHAR(191) NULL,
    `roomStatusAfter` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `changedById` VARCHAR(191) NULL,
    `changedByName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `hk_status_logs_tenant_task_created_idx`(`tenantId`, `taskId`, `createdAt`),
    INDEX `hk_status_logs_taskId_fkey`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `housekeeping_task_status_logs` ADD CONSTRAINT `hk_status_logs_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `housekeeping_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
