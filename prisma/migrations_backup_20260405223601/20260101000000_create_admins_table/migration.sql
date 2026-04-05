-- CreateTable
CREATE TABLE `admins` (
    `id` VARCHAR(36) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'platform_admin',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastLoginAt` DATETIME(0) NULL,
    `lastLoginIp` VARCHAR(191) NULL,
    `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX `IDX_051db7d37d478a69a7432df147`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
