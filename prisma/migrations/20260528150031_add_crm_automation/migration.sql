-- CreateTable
CREATE TABLE `crm_campaigns` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `templateKey` VARCHAR(100) NULL,
    `subject` VARCHAR(255) NULL,
    `bodyOverride` TEXT NULL,
    `audienceQuery` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `totalRecipients` INTEGER NOT NULL DEFAULT 0,
    `totalSent` INTEGER NOT NULL DEFAULT 0,
    `totalOpened` INTEGER NOT NULL DEFAULT 0,
    `totalClicked` INTEGER NOT NULL DEFAULT 0,
    `totalFailed` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_campaigns_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `crm_campaigns_tenantId_scheduledAt_idx`(`tenantId`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_campaign_deliveries` (
    `id` VARCHAR(36) NOT NULL,
    `campaignId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `guestId` VARCHAR(36) NULL,
    `contactId` VARCHAR(36) NULL,
    `recipient` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `errorMessage` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `openedAt` DATETIME(3) NULL,
    `clickedAt` DATETIME(3) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_campaign_deliveries_campaignId_status_idx`(`campaignId`, `status`),
    INDEX `crm_campaign_deliveries_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `crm_campaign_deliveries_guestId_idx`(`guestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_journeys` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `triggerEvent` VARCHAR(50) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `stepsConfig` LONGTEXT NOT NULL,
    `createdById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_journeys_tenantId_isActive_idx`(`tenantId`, `isActive`),
    INDEX `crm_journeys_triggerEvent_idx`(`triggerEvent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_journey_enrollments` (
    `id` VARCHAR(36) NOT NULL,
    `journeyId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `guestId` VARCHAR(36) NOT NULL,
    `contactId` VARCHAR(36) NULL,
    `bookingId` VARCHAR(36) NULL,
    `currentStepIdx` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `nextRunAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `metadata` TEXT NULL,

    INDEX `crm_journey_enrollments_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `crm_journey_enrollments_status_nextRunAt_idx`(`status`, `nextRunAt`),
    INDEX `crm_journey_enrollments_guestId_idx`(`guestId`),
    UNIQUE INDEX `crm_journey_enrollments_journeyId_guestId_bookingId_key`(`journeyId`, `guestId`, `bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `crm_campaign_deliveries` ADD CONSTRAINT `crm_campaign_deliveries_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `crm_campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_journey_enrollments` ADD CONSTRAINT `crm_journey_enrollments_journeyId_fkey` FOREIGN KEY (`journeyId`) REFERENCES `crm_journeys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
