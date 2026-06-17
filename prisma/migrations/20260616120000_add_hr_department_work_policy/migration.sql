-- Department work policy: weekly work pattern / day-off rules per department.
-- Used by the roster to block shift assignments on enforced day-off weekdays.

CREATE TABLE `hr_department_work_policies` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `departmentId` VARCHAR(191) NOT NULL,
  `pattern` VARCHAR(191) NOT NULL DEFAULT 'FLEXIBLE',
  `offDays` JSON NOT NULL,
  `enforceOffDays` BOOLEAN NOT NULL DEFAULT true,
  `defaultShiftTypeId` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `hr_department_work_policies_departmentId_key`(`departmentId`),
  INDEX `hr_department_work_policies_tenantId_idx`(`tenantId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_department_work_policies` ADD CONSTRAINT `hr_department_work_policies_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `hr_departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
