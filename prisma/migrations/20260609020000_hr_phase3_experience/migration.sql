-- Phase 3: Employee Experience & HR Intelligence
-- Training / certification records (self-service & analytics read from existing tables).

CREATE TABLE `hr_training_records` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'training',
  `provider` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'planned',
  `completedAt` DATE NULL,
  `expiresAt` DATE NULL,
  `score` DECIMAL(5, 2) NULL,
  `certificateUrl` TEXT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_training_records_tenantId_idx`(`tenantId`),
  INDEX `hr_training_records_employeeId_idx`(`employeeId`),
  INDEX `hr_training_records_type_idx`(`type`),
  INDEX `hr_training_records_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_training_records`
  ADD CONSTRAINT `hr_training_records_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
