-- Recruitment → Probation redesign (2026-06-10)
-- New pipeline tables + migrate hr_probation_reviews → hr_probation_rounds, then drop old table.

-- Stage 1+2: manpower request + budget
CREATE TABLE `hr_manpower_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `requestNo` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NULL,
    `positionId` VARCHAR(191) NULL,
    `positionTitle` VARCHAR(191) NOT NULL,
    `headcount` INTEGER NOT NULL DEFAULT 1,
    `employmentType` VARCHAR(191) NOT NULL DEFAULT 'FULLTIME',
    `reason` TEXT NOT NULL,
    `jobDescription` TEXT NULL,
    `expectedStartDate` DATE NULL,
    `salaryRangeMin` DECIMAL(12, 2) NULL,
    `salaryRangeMax` DECIMAL(12, 2) NULL,
    `budgetTotal` DECIMAL(12, 2) NULL,
    `budgetNote` TEXT NULL,
    `budgetChain` JSON NULL,
    `budgetApprovedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `approvalChain` JSON NULL,
    `currentApprovalLevel` INTEGER NOT NULL DEFAULT 0,
    `requestedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_manpower_requests_tenantId_requestNo_key`(`tenantId`, `requestNo`),
    INDEX `hr_manpower_requests_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stage 3: equipment request
CREATE TABLE `hr_equipment_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `manpowerRequestId` VARCHAR(191) NOT NULL,
    `items` JSON NOT NULL,
    `totalCost` DECIMAL(12, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `approvalChain` JSON NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_equipment_requests_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stage 4: candidates + interviews
CREATE TABLE `hr_candidates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `manpowerRequestId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `resumeUrl` VARCHAR(191) NULL,
    `source` VARCHAR(191) NULL,
    `expectedSalary` DECIMAL(12, 2) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'applied',
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_candidates_tenantId_manpowerRequestId_status_idx`(`tenantId`, `manpowerRequestId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_interviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL DEFAULT 1,
    `scheduledAt` DATETIME(3) NOT NULL,
    `location` VARCHAR(191) NULL,
    `interviewerIds` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `score` DECIMAL(5, 2) NULL,
    `feedback` TEXT NULL,
    `result` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_interviews_tenantId_scheduledAt_idx`(`tenantId`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stage 5: hire records
CREATE TABLE `hr_hire_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `candidateId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `offeredSalary` DECIMAL(12, 2) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `startTime` VARCHAR(191) NULL,
    `probationDays` INTEGER NOT NULL DEFAULT 90,
    `offerStatus` VARCHAR(191) NOT NULL DEFAULT 'offered',
    `offerSentAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_hire_records_candidateId_key`(`candidateId`),
    UNIQUE INDEX `hr_hire_records_employeeId_key`(`employeeId`),
    INDEX `hr_hire_records_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stage 6: equipment issuance
CREATE TABLE `hr_equipment_issuances` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `equipmentRequestId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `issuedBy` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `signatureUrl` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_equipment_issuances_tenantId_employeeId_idx`(`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Stage 7: probation rounds + checkpoints
CREATE TABLE `hr_probation_rounds` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `hireRecordId` VARCHAR(191) NULL,
    `startDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `extendedFrom` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hr_probation_rounds_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `hr_probation_rounds_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_probation_checkpoints` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `roundId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `dueDate` DATE NOT NULL,
    `score` DECIMAL(5, 2) NULL,
    `strengths` TEXT NULL,
    `improvements` TEXT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',

    INDEX `hr_probation_checkpoints_roundId_idx`(`roundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FKs
ALTER TABLE `hr_equipment_requests` ADD CONSTRAINT `hr_equipment_requests_manpowerRequestId_fkey` FOREIGN KEY (`manpowerRequestId`) REFERENCES `hr_manpower_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_candidates` ADD CONSTRAINT `hr_candidates_manpowerRequestId_fkey` FOREIGN KEY (`manpowerRequestId`) REFERENCES `hr_manpower_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_interviews` ADD CONSTRAINT `hr_interviews_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `hr_candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_hire_records` ADD CONSTRAINT `hr_hire_records_candidateId_fkey` FOREIGN KEY (`candidateId`) REFERENCES `hr_candidates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_hire_records` ADD CONSTRAINT `hr_hire_records_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `hr_equipment_issuances` ADD CONSTRAINT `hr_equipment_issuances_equipmentRequestId_fkey` FOREIGN KEY (`equipmentRequestId`) REFERENCES `hr_equipment_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_equipment_issuances` ADD CONSTRAINT `hr_equipment_issuances_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_probation_rounds` ADD CONSTRAINT `hr_probation_rounds_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `hr_probation_checkpoints` ADD CONSTRAINT `hr_probation_checkpoints_roundId_fkey` FOREIGN KEY (`roundId`) REFERENCES `hr_probation_rounds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate old probation reviews → rounds (pending→active, others map ตรงตัว)
INSERT INTO `hr_probation_rounds`
    (`id`, `tenantId`, `employeeId`, `startDate`, `dueDate`, `status`, `decidedBy`, `decidedAt`, `decisionNote`, `createdAt`, `updatedAt`)
SELECT
    `id`, `tenantId`, `employeeId`, `startDate`, `dueDate`,
    CASE `decision` WHEN 'pending' THEN 'active' ELSE `decision` END,
    `reviewerId`,
    `reviewDate`,
    `note`,
    `createdAt`, `updatedAt`
FROM `hr_probation_reviews`;

-- Drop old table
DROP TABLE `hr_probation_reviews`;
