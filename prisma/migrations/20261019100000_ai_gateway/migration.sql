-- CreateTable
CREATE TABLE `ai_provider_configs` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `apiKeyEnc` TEXT NULL,
    `keyLast4` VARCHAR(8) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `models` JSON NOT NULL,
    `lastTestedAt` DATETIME(3) NULL,
    `lastTestOk` BOOLEAN NULL,
    `lastTestMessage` VARCHAR(255) NULL,
    `lastTestLatencyMs` INTEGER NULL,
    `updatedBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_provider_configs_provider_key`(`provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_platform_settings` (
    `id` VARCHAR(20) NOT NULL DEFAULT 'default',
    `monthlyBudgetUsd` DECIMAL(12, 2) NOT NULL DEFAULT 100.00,
    `hardStopOnBudget` BOOLEAN NOT NULL DEFAULT true,
    `alertThresholdPct` INTEGER NOT NULL DEFAULT 80,
    `usdToThb` DECIMAL(10, 4) NOT NULL DEFAULT 36.0000,
    `updatedBy` VARCHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_usage_logs` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NULL,
    `provider` VARCHAR(20) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `feature` VARCHAR(60) NOT NULL,
    `task` VARCHAR(40) NULL,
    `status` VARCHAR(20) NOT NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `units` INTEGER NULL,
    `costUsd` DECIMAL(12, 6) NOT NULL DEFAULT 0,
    `latencyMs` INTEGER NULL,
    `errorMessage` VARCHAR(255) NULL,
    `refType` VARCHAR(40) NULL,
    `refId` VARCHAR(36) NULL,
    `createdBy` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_usage_logs_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `ai_usage_logs_createdAt_idx`(`createdAt`),
    INDEX `ai_usage_logs_provider_createdAt_idx`(`provider`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

