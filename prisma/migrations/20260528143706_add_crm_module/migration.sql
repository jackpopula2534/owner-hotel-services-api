-- CreateTable
CREATE TABLE `crm_contacts` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `guestId` VARCHAR(36) NULL,
    `companyName` VARCHAR(200) NULL,
    `contactType` VARCHAR(30) NOT NULL DEFAULT 'individual',
    `segment` VARCHAR(50) NULL,
    `rfmRecency` INTEGER NULL,
    `rfmFrequency` INTEGER NULL,
    `rfmMonetary` INTEGER NULL,
    `lifetimeValue` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `totalStays` INTEGER NOT NULL DEFAULT 0,
    `lastStayAt` DATETIME(3) NULL,
    `preferredChannel` VARCHAR(20) NULL,
    `tags` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_contacts_tenantId_segment_idx`(`tenantId`, `segment`),
    INDEX `crm_contacts_tenantId_contactType_idx`(`tenantId`, `contactType`),
    INDEX `crm_contacts_guestId_idx`(`guestId`),
    UNIQUE INDEX `crm_contacts_tenantId_guestId_key`(`tenantId`, `guestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_tickets` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `contactId` VARCHAR(36) NULL,
    `guestId` VARCHAR(36) NULL,
    `bookingId` VARCHAR(36) NULL,
    `subject` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'manual',
    `category` VARCHAR(50) NULL,
    `priority` VARCHAR(20) NOT NULL DEFAULT 'normal',
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `assignedToId` VARCHAR(36) NULL,
    `slaDueAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `csatScore` INTEGER NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_tickets_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `crm_tickets_tenantId_priority_status_idx`(`tenantId`, `priority`, `status`),
    INDEX `crm_tickets_guestId_idx`(`guestId`),
    INDEX `crm_tickets_bookingId_idx`(`bookingId`),
    INDEX `crm_tickets_assignedToId_idx`(`assignedToId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loyalty_transactions` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `guestId` VARCHAR(36) NOT NULL,
    `contactId` VARCHAR(36) NULL,
    `type` VARCHAR(20) NOT NULL,
    `points` INTEGER NOT NULL,
    `bookingId` VARCHAR(36) NULL,
    `reason` VARCHAR(255) NULL,
    `metadata` TEXT NULL,
    `balanceAfter` INTEGER NULL,
    `tierAfter` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `loyalty_transactions_tenantId_guestId_createdAt_idx`(`tenantId`, `guestId`, `createdAt`),
    INDEX `loyalty_transactions_tenantId_type_idx`(`tenantId`, `type`),
    INDEX `loyalty_transactions_bookingId_idx`(`bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `crm_tickets` ADD CONSTRAINT `crm_tickets_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `crm_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_transactions` ADD CONSTRAINT `loyalty_transactions_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `crm_contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
