CREATE TABLE `hr_document_types` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'general',
  `description` TEXT NULL,
  `requiredByDefault` BOOLEAN NOT NULL DEFAULT false,
  `hasExpiry` BOOLEAN NOT NULL DEFAULT false,
  `expiryPolicyDays` INTEGER NULL,
  `accessLevel` VARCHAR(191) NOT NULL DEFAULT 'hr',
  `requiresVerification` BOOLEAN NOT NULL DEFAULT false,
  `allowedFileTypes` JSON NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_document_types_tenantId_code_key`(`tenantId`, `code`),
  INDEX `hr_document_types_tenantId_idx`(`tenantId`),
  INDEX `hr_document_types_category_idx`(`category`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_lifecycle_packages` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `lifecycleType` VARCHAR(191) NOT NULL DEFAULT 'onboarding',
  `description` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_lifecycle_packages_tenantId_code_key`(`tenantId`, `code`),
  INDEX `hr_lifecycle_packages_tenantId_idx`(`tenantId`),
  INDEX `hr_lifecycle_packages_lifecycleType_idx`(`lifecycleType`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_lifecycle_package_documents` (
  `id` VARCHAR(191) NOT NULL,
  `packageId` VARCHAR(191) NOT NULL,
  `documentTypeId` VARCHAR(191) NOT NULL,
  `isRequired` BOOLEAN NOT NULL DEFAULT true,
  `dueOffsetDays` INTEGER NULL,
  `ruleNote` TEXT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_lifecycle_package_documents_packageId_documentTypeId_key`(`packageId`, `documentTypeId`),
  INDEX `hr_lifecycle_package_documents_documentTypeId_idx`(`documentTypeId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_lifecycle_package_tasks` (
  `id` VARCHAR(191) NOT NULL,
  `packageId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'general',
  `ownerRole` VARCHAR(191) NULL,
  `dueOffsetDays` INTEGER NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `requiresApproval` BOOLEAN NOT NULL DEFAULT false,
  `note` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_lifecycle_package_tasks_packageId_idx`(`packageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_lifecycle_assignment_rules` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `packageId` VARCHAR(191) NOT NULL,
  `propertyId` VARCHAR(191) NULL,
  `departmentId` VARCHAR(191) NULL,
  `positionId` VARCHAR(191) NULL,
  `employmentType` VARCHAR(191) NULL,
  `priority` INTEGER NOT NULL DEFAULT 100,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_lifecycle_assignment_rules_tenantId_idx`(`tenantId`),
  INDEX `hr_lifecycle_assignment_rules_packageId_idx`(`packageId`),
  INDEX `hr_lifecycle_assignment_rules_propertyId_idx`(`propertyId`),
  INDEX `hr_lifecycle_assignment_rules_departmentId_idx`(`departmentId`),
  INDEX `hr_lifecycle_assignment_rules_positionId_idx`(`positionId`),
  INDEX `hr_lifecycle_assignment_rules_employmentType_idx`(`employmentType`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_employee_lifecycle_assignments` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `packageId` VARCHAR(191) NOT NULL,
  `sourceRuleId` VARCHAR(191) NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `assignedBy` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_employee_lifecycle_assignments_tenantId_idx`(`tenantId`),
  INDEX `hr_employee_lifecycle_assignments_employeeId_idx`(`employeeId`),
  INDEX `hr_employee_lifecycle_assignments_packageId_idx`(`packageId`),
  INDEX `hr_employee_lifecycle_assignments_sourceRuleId_idx`(`sourceRuleId`),
  INDEX `hr_employee_lifecycle_assignments_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_employee_document_requirements` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `employeeId` VARCHAR(191) NOT NULL,
  `documentTypeId` VARCHAR(191) NOT NULL,
  `packageId` VARCHAR(191) NULL,
  `assignmentId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'missing',
  `dueDate` DATE NULL,
  `uploadedDocumentId` VARCHAR(191) NULL,
  `verifiedBy` VARCHAR(191) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `waivedReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `hr_employee_document_requirements_tenantId_idx`(`tenantId`),
  INDEX `hr_employee_document_requirements_employeeId_idx`(`employeeId`),
  INDEX `hr_employee_document_requirements_documentTypeId_idx`(`documentTypeId`),
  INDEX `hr_employee_document_requirements_packageId_idx`(`packageId`),
  INDEX `hr_employee_document_requirements_assignmentId_idx`(`assignmentId`),
  INDEX `hr_employee_document_requirements_status_idx`(`status`),
  INDEX `hr_employee_document_requirements_dueDate_idx`(`dueDate`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_lifecycle_package_documents`
  ADD CONSTRAINT `hr_lifecycle_package_documents_packageId_fkey`
    FOREIGN KEY (`packageId`) REFERENCES `hr_lifecycle_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_lifecycle_package_documents_documentTypeId_fkey`
    FOREIGN KEY (`documentTypeId`) REFERENCES `hr_document_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `hr_lifecycle_package_tasks`
  ADD CONSTRAINT `hr_lifecycle_package_tasks_packageId_fkey`
    FOREIGN KEY (`packageId`) REFERENCES `hr_lifecycle_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `hr_lifecycle_assignment_rules`
  ADD CONSTRAINT `hr_lifecycle_assignment_rules_packageId_fkey`
    FOREIGN KEY (`packageId`) REFERENCES `hr_lifecycle_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_lifecycle_assignment_rules_propertyId_fkey`
    FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_lifecycle_assignment_rules_departmentId_fkey`
    FOREIGN KEY (`departmentId`) REFERENCES `hr_departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_lifecycle_assignment_rules_positionId_fkey`
    FOREIGN KEY (`positionId`) REFERENCES `hr_positions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hr_employee_lifecycle_assignments`
  ADD CONSTRAINT `hr_employee_lifecycle_assignments_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_lifecycle_assignments_packageId_fkey`
    FOREIGN KEY (`packageId`) REFERENCES `hr_lifecycle_packages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_lifecycle_assignments_sourceRuleId_fkey`
    FOREIGN KEY (`sourceRuleId`) REFERENCES `hr_lifecycle_assignment_rules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hr_employee_document_requirements`
  ADD CONSTRAINT `hr_employee_document_requirements_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_document_requirements_documentTypeId_fkey`
    FOREIGN KEY (`documentTypeId`) REFERENCES `hr_document_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_document_requirements_packageId_fkey`
    FOREIGN KEY (`packageId`) REFERENCES `hr_lifecycle_packages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_document_requirements_assignmentId_fkey`
    FOREIGN KEY (`assignmentId`) REFERENCES `hr_employee_lifecycle_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_employee_document_requirements_uploadedDocumentId_fkey`
    FOREIGN KEY (`uploadedDocumentId`) REFERENCES `hr_employee_documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
