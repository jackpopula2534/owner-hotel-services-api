-- โปรโมชั่น Retail POS: โค้ดส่วนลด/ของแถม + ผูกสมาชิก (Guest) + คลังของแถม (WarehouseType.PROMOTION)
-- แผน: docs/RETAIL_PROMOTIONS_PLAN.md

-- AlterTable
ALTER TABLE `retail_sale_items` ADD COLUMN `isGift` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `promotionId` VARCHAR(191) NULL,
    ADD COLUMN `sourceWarehouseId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `retail_sales` ADD COLUMN `memberContactId` VARCHAR(191) NULL,
    ADD COLUMN `memberGuestId` VARCHAR(191) NULL,
    ADD COLUMN `promoCode` VARCHAR(40) NULL,
    ADD COLUMN `promoDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `promoGiftCost` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `promotionId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `warehouses` MODIFY `type` ENUM('GENERAL', 'KITCHEN', 'HOUSEKEEPING', 'MAINTENANCE', 'MINIBAR', 'PROMOTION') NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE `retail_promotions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `discountType` ENUM('NONE', 'PERCENT', 'FIXED') NOT NULL DEFAULT 'NONE',
    `discountValue` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `maxDiscount` DECIMAL(10, 2) NULL,
    `minSpend` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `eligibleItemIds` JSON NULL,
    `eligibleTiers` JSON NULL,
    `eligibleSegments` JSON NULL,
    `giftWarehouseId` VARCHAR(191) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `usageLimit` INTEGER NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `perMemberLimit` INTEGER NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `retail_promotions_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retail_promo_codes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `promotionId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `kind` ENUM('SHARED', 'UNIQUE') NOT NULL DEFAULT 'SHARED',
    `maxUses` INTEGER NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `issuedToGuestId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `retail_promo_codes_promotionId_idx`(`promotionId`),
    UNIQUE INDEX `retail_promo_codes_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retail_promotion_gifts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `promotionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `budgetQty` INTEGER NULL,
    `issuedQty` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `retail_promotion_gifts_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `retail_promotion_gifts_promotionId_itemId_key`(`promotionId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retail_promotion_member_usage` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `promotionId` VARCHAR(191) NOT NULL,
    `guestId` VARCHAR(191) NOT NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

INDEX `retail_promotion_member_usage_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `retail_promotion_member_usage_promotionId_guestId_key`(`promotionId`, `guestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `retail_promotion_redemptions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `promotionId` VARCHAR(191) NOT NULL,
    `promoCodeId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `guestId` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `discountAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `giftCost` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `giftSkipped` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('APPLIED', 'REVERSED') NOT NULL DEFAULT 'APPLIED',
    `redeemedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,

UNIQUE INDEX `retail_promotion_redemptions_saleId_key`(`saleId`),
    INDEX `retail_promotion_redemptions_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `retail_promotion_redemptions_promotionId_idx`(`promotionId`),
    INDEX `retail_promotion_redemptions_guestId_idx`(`guestId`),
    INDEX `retail_promotion_redemptions_contactId_idx`(`contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `retail_sales_memberGuestId_idx` ON `retail_sales`(`memberGuestId`);

-- CreateIndex
CREATE INDEX `retail_sales_promotionId_idx` ON `retail_sales`(`promotionId`);

-- AddForeignKey
ALTER TABLE `retail_promo_codes` ADD CONSTRAINT `retail_promo_codes_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `retail_promotions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `retail_promotion_gifts` ADD CONSTRAINT `retail_promotion_gifts_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `retail_promotions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `retail_promotion_redemptions` ADD CONSTRAINT `retail_promotion_redemptions_promotionId_fkey` FOREIGN KEY (`promotionId`) REFERENCES `retail_promotions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
