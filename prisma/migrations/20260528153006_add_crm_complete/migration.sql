-- CreateTable
CREATE TABLE `crm_sentiment_analyses` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `sourceType` VARCHAR(20) NOT NULL,
    `sourceId` VARCHAR(36) NOT NULL,
    `text` TEXT NOT NULL,
    `language` VARCHAR(10) NULL,
    `label` VARCHAR(20) NOT NULL,
    `score` DECIMAL(5, 4) NOT NULL,
    `confidence` DECIMAL(5, 4) NOT NULL,
    `keywords` TEXT NULL,
    `analyzedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_sentiment_analyses_tenantId_label_idx`(`tenantId`, `label`),
    INDEX `crm_sentiment_analyses_tenantId_analyzedAt_idx`(`tenantId`, `analyzedAt`),
    UNIQUE INDEX `crm_sentiment_analyses_sourceType_sourceId_key`(`sourceType`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_churn_scores` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `guestId` VARCHAR(36) NOT NULL,
    `contactId` VARCHAR(36) NULL,
    `riskScore` DECIMAL(5, 4) NOT NULL,
    `riskBand` VARCHAR(20) NOT NULL,
    `reasons` TEXT NULL,
    `daysSinceLastStay` INTEGER NULL,
    `staysLast90d` INTEGER NULL,
    `staysLast365d` INTEGER NULL,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `crm_churn_scores_tenantId_guestId_computedAt_idx`(`tenantId`, `guestId`, `computedAt`),
    INDEX `crm_churn_scores_tenantId_riskBand_idx`(`tenantId`, `riskBand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
