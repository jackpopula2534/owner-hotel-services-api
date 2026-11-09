-- CreateTable
CREATE TABLE `channel_integrations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `externalAccountId` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NULL,
    `accessToken` TEXT NULL,
    `channelSecret` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DISCONNECTED',
    `statusMessage` TEXT NULL,
    `webhookVerified` BOOLEAN NOT NULL DEFAULT false,
    `tokenExpiresAt` DATETIME(3) NULL,
    `connectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `channel_integrations_channel_externalAccountId_idx`(`channel`, `externalAccountId`),
    UNIQUE INDEX `channel_integrations_tenantId_channel_key`(`tenantId`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
