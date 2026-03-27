-- CreateTable for user_tenants junction table (multi-tenant support)
CREATE TABLE `user_tenants` (
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(36) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `user_tenants_userId_tenantId_key`(`userId`, `tenantId`),
    INDEX `user_tenants_userId_idx`(`userId`),
    INDEX `user_tenants_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_tenants` ADD CONSTRAINT `user_tenants_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_tenants` ADD CONSTRAINT `user_tenants_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
