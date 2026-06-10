-- Phase 2: Employee Lifecycle & Compliance
-- Documents, onboarding, probation, leave policy, offboarding/clearance.

CREATE TABLE `hr_employee_documents` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `fileUrl` TEXT NOT NULL,
  `fileName` VARCHAR(191) NULL,
  `mimeType` VARCHAR(191) NULL,
  `fileSize` INTEGER NULL,
  `issuedAt` DATE NULL,
  `expiresAt` DATE NULL,
  `accessLevel` VARCHAR(191) NOT NULL DEFAULT 'hr',
  `note` TEXT NULL,
  `uploadedBy` VARCHAR(191) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_employee_documents_tenantId_idx`(`tenantId`),
  INDEX `hr_employee_documents_employeeId_idx`(`employeeId`),
  INDEX `hr_employee_documents_type_idx`(`type`),
  INDEX `hr_employee_documents_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_onboarding_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'general',
  `isComplete` BOOLEAN NOT NULL DEFAULT false,
  `completedAt` DATETIME(3) NULL,
  `completedBy` VARCHAR(191) NULL,
  `dueDate` DATE NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_onboarding_tasks_tenantId_idx`(`tenantId`),
  INDEX `hr_onboarding_tasks_employeeId_idx`(`employeeId`),
  INDEX `hr_onboarding_tasks_isComplete_idx`(`isComplete`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_probation_reviews` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `startDate` DATE NOT NULL,
  `dueDate` DATE NOT NULL,
  `reviewDate` DATE NULL,
  `reviewerId` VARCHAR(191) NULL,
  `score` DECIMAL(5, 2) NULL,
  `decision` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `strengths` TEXT NULL,
  `improvements` TEXT NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_probation_reviews_tenantId_idx`(`tenantId`),
  INDEX `hr_probation_reviews_employeeId_idx`(`employeeId`),
  INDEX `hr_probation_reviews_decision_idx`(`decision`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_leave_policies` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `leaveTypeId` VARCHAR(191) NULL,
  `name` VARCHAR(191) NOT NULL,
  `minTenureMonths` INTEGER NOT NULL DEFAULT 0,
  `entitlementDays` INTEGER NOT NULL DEFAULT 0,
  `requiresAttachment` BOOLEAN NOT NULL DEFAULT false,
  `approvalLevels` INTEGER NOT NULL DEFAULT 1,
  `blackoutDates` JSON NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_leave_policies_tenantId_idx`(`tenantId`),
  INDEX `hr_leave_policies_leaveTypeId_idx`(`leaveTypeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_offboardings` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL,
  `noticeDate` DATE NULL,
  `lastWorkingDate` DATE NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'initiated',
  `clearanceItems` JSON NULL,
  `accountRevoked` BOOLEAN NOT NULL DEFAULT false,
  `staffUnlinked` BOOLEAN NOT NULL DEFAULT false,
  `finalPayrollId` VARCHAR(191) NULL,
  `initiatedBy` VARCHAR(191) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_offboardings_tenantId_idx`(`tenantId`),
  INDEX `hr_offboardings_employeeId_idx`(`employeeId`),
  INDEX `hr_offboardings_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- HrLeaveRequest: attachment + multi-step approval chain
ALTER TABLE `hr_leave_requests`
  ADD COLUMN `attachmentUrl` TEXT NULL,
  ADD COLUMN `approvalChain` JSON NULL,
  ADD COLUMN `currentLevel` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `requiredLevels` INTEGER NOT NULL DEFAULT 1;

-- Foreign keys
ALTER TABLE `hr_employee_documents`
  ADD CONSTRAINT `hr_employee_documents_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_onboarding_tasks`
  ADD CONSTRAINT `hr_onboarding_tasks_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_probation_reviews`
  ADD CONSTRAINT `hr_probation_reviews_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_offboardings`
  ADD CONSTRAINT `hr_offboardings_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
