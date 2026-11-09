-- AlterTable: public application dataset on hr_candidates
ALTER TABLE `hr_candidates` ADD COLUMN `applicationData` JSON NULL,
    ADD COLUMN `attachments` JSON NULL,
    ADD COLUMN `consentAt` DATETIME(3) NULL,
    ADD COLUMN `consentGiven` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `jobPostingId` VARCHAR(191) NULL;

-- CreateTable: public job postings (one per manpower request)
CREATE TABLE `hr_job_postings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NULL,
    `manpowerRequestId` VARCHAR(191) NOT NULL,
    `publicToken` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `location` VARCHAR(191) NULL,
    `employmentType` VARCHAR(191) NULL,
    `salaryRangeText` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `openAt` DATETIME(3) NULL,
    `closeAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_job_postings_manpowerRequestId_key`(`manpowerRequestId`),
    UNIQUE INDEX `hr_job_postings_publicToken_key`(`publicToken`),
    INDEX `hr_job_postings_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_job_postings` ADD CONSTRAINT `hr_job_postings_manpowerRequestId_fkey` FOREIGN KEY (`manpowerRequestId`) REFERENCES `hr_manpower_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
