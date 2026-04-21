-- CreateTable
CREATE TABLE `hr_performances` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `periodType` VARCHAR(191) NOT NULL DEFAULT 'quarterly',
    `reviewDate` DATE NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `reviewerName` VARCHAR(191) NULL,
    `scoreWork` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `scoreAttendance` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `scoreTeamwork` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `scoreService` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `scoreOverall` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `grade` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `strengths` TEXT NULL,
    `improvements` TEXT NULL,
    `goals` TEXT NULL,
    `note` TEXT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_performances_employeeId_period_key`(`employeeId`, `period`),
    INDEX `hr_performances_tenantId_idx`(`tenantId`),
    INDEX `hr_performances_employeeId_idx`(`employeeId`),
    INDEX `hr_performances_period_idx`(`period`),
    INDEX `hr_performances_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_performances` ADD CONSTRAINT `hr_performances_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
