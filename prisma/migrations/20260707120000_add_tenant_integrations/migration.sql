-- CreateTable
CREATE TABLE `tenant_integrations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `integrationKey` VARCHAR(80) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NULL,
    `connectedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tenant_integrations_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `tenant_integrations_tenantId_integrationKey_key`(`tenantId`, `integrationKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
