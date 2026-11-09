-- CreateTable
CREATE TABLE `addon_quota_configs` (
    `id` VARCHAR(36) NOT NULL,
    `addonCode` VARCHAR(80) NOT NULL,
    `metricCode` VARCHAR(80) NOT NULL,
    `includedPerPeriod` INTEGER NOT NULL DEFAULT 0,
    `overageUnitPriceThb` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `maxOveragePerPeriod` INTEGER NULL,
    `trialDays` INTEGER NOT NULL DEFAULT 14,
    `trialIncluded` INTEGER NOT NULL DEFAULT 0,
    `rateLimitPerMinute` INTEGER NOT NULL DEFAULT 0,
    `refundOnFailure` BOOLEAN NOT NULL DEFAULT true,
    `updatedBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `addon_quota_configs_addonCode_key`(`addonCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `addon_usage_reservations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `addonCode` VARCHAR(80) NOT NULL,
    `metricCode` VARCHAR(80) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `isOverage` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(20) NOT NULL DEFAULT 'reserved',
    `refType` VARCHAR(40) NULL,
    `refId` VARCHAR(36) NULL,
    `failureReason` VARCHAR(255) NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,

    INDEX `addon_usage_reservations_tenantId_addonCode_createdAt_idx`(`tenantId`, `addonCode`, `createdAt`),
    INDEX `addon_usage_reservations_tenantId_metricCode_period_idx`(`tenantId`, `metricCode`, `period`),
    INDEX `addon_usage_reservations_addonCode_period_idx`(`addonCode`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
