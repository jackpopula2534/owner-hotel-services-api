-- CreateTable
CREATE TABLE `opcost_categories` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `nameEn` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `color` VARCHAR(20) NULL,
    `icon` VARCHAR(50) NULL,
    `isCogs` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `opcost_categories_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opcost_vendors` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `website` VARCHAR(255) NULL,
    `contactName` VARCHAR(100) NULL,
    `contactEmail` VARCHAR(150) NULL,
    `notes` TEXT NULL,
    `categoryId` VARCHAR(36) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opcost_vendors_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opcost_expenses` (
    `id` VARCHAR(36) NOT NULL,
    `categoryId` VARCHAR(36) NOT NULL,
    `vendorId` VARCHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'THB',
    `type` ENUM('RECURRING', 'ONE_TIME', 'USAGE') NOT NULL,
    `behavior` ENUM('FIXED', 'VARIABLE', 'SEMI_VARIABLE') NOT NULL DEFAULT 'FIXED',
    `billingCycle` ENUM('MONTHLY', 'QUARTERLY', 'YEARLY') NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `tags` TEXT NULL,
    `reference` VARCHAR(150) NULL,
    `attachmentUrl` VARCHAR(500) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(36) NULL,

    INDEX `opcost_expenses_categoryId_idx`(`categoryId`),
    INDEX `opcost_expenses_vendorId_idx`(`vendorId`),
    INDEX `opcost_expenses_type_isActive_idx`(`type`, `isActive`),
    INDEX `opcost_expenses_startDate_endDate_idx`(`startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opcost_monthly_snapshots` (
    `id` VARCHAR(36) NOT NULL,
    `expenseId` VARCHAR(36) NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `amountForMonth` DECIMAL(12, 2) NOT NULL,
    `categoryCode` VARCHAR(50) NOT NULL,
    `behavior` ENUM('FIXED', 'VARIABLE', 'SEMI_VARIABLE') NOT NULL DEFAULT 'FIXED',
    `isCogs` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opcost_monthly_snapshots_year_month_idx`(`year`, `month`),
    INDEX `opcost_monthly_snapshots_categoryCode_year_month_idx`(`categoryCode`, `year`, `month`),
    UNIQUE INDEX `opcost_monthly_snapshots_expenseId_year_month_key`(`expenseId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opcost_budgets` (
    `id` VARCHAR(36) NOT NULL,
    `categoryId` VARCHAR(36) NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NULL,
    `budgetAmount` DECIMAL(12, 2) NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `opcost_budgets_categoryId_year_month_key`(`categoryId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `opcost_marketing_campaigns` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `channel` VARCHAR(50) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NULL,
    `totalSpend` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `attributedTenants` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `opcost_marketing_campaigns_startDate_endDate_idx`(`startDate`, `endDate`),
    INDEX `opcost_marketing_campaigns_channel_idx`(`channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `opcost_vendors` ADD CONSTRAINT `opcost_vendors_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `opcost_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opcost_expenses` ADD CONSTRAINT `opcost_expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `opcost_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opcost_expenses` ADD CONSTRAINT `opcost_expenses_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `opcost_vendors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opcost_monthly_snapshots` ADD CONSTRAINT `opcost_monthly_snapshots_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `opcost_expenses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `opcost_budgets` ADD CONSTRAINT `opcost_budgets_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `opcost_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
