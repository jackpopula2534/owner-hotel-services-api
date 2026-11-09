-- CreateTable
CREATE TABLE `crm_leads` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `contactId` VARCHAR(36) NULL,
    `companyName` VARCHAR(200) NULL,
    `contactName` VARCHAR(200) NOT NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `source` VARCHAR(50) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'new',
    `score` INTEGER NOT NULL DEFAULT 0,
    `estValue` DECIMAL(14, 2) NULL,
    `expectedCheckIn` DATETIME(3) NULL,
    `expectedCheckOut` DATETIME(3) NULL,
    `partySize` INTEGER NULL,
    `notes` TEXT NULL,
    `ownerUserId` VARCHAR(36) NULL,
    `convertedDealId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_leads_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `crm_leads_tenantId_source_idx`(`tenantId`, `source`),
    INDEX `crm_leads_ownerUserId_idx`(`ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_deals` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `leadId` VARCHAR(36) NULL,
    `contactId` VARCHAR(36) NULL,
    `companyName` VARCHAR(200) NULL,
    `name` VARCHAR(200) NOT NULL,
    `stage` VARCHAR(20) NOT NULL DEFAULT 'discovery',
    `amount` DECIMAL(14, 2) NOT NULL,
    `probability` INTEGER NOT NULL DEFAULT 20,
    `expectedCloseDate` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `lostReason` VARCHAR(255) NULL,
    `ownerUserId` VARCHAR(36) NULL,
    `bookingIds` TEXT NULL,
    `partySize` INTEGER NULL,
    `checkInDate` DATETIME(3) NULL,
    `checkOutDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_deals_tenantId_stage_idx`(`tenantId`, `stage`),
    INDEX `crm_deals_tenantId_expectedCloseDate_idx`(`tenantId`, `expectedCloseDate`),
    INDEX `crm_deals_ownerUserId_idx`(`ownerUserId`),
    INDEX `crm_deals_leadId_idx`(`leadId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_sales_activities` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `leadId` VARCHAR(36) NULL,
    `dealId` VARCHAR(36) NULL,
    `type` VARCHAR(20) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` TEXT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `authorUserId` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_sales_activities_tenantId_leadId_occurredAt_idx`(`tenantId`, `leadId`, `occurredAt`),
    INDEX `crm_sales_activities_tenantId_dealId_occurredAt_idx`(`tenantId`, `dealId`, `occurredAt`),
    INDEX `crm_sales_activities_tenantId_type_idx`(`tenantId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `crm_sales_activities` ADD CONSTRAINT `crm_sales_activities_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `crm_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_sales_activities` ADD CONSTRAINT `crm_sales_activities_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `crm_deals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
