-- โค้ดส่วนลดของโรงแรม (ต่อ property) สำหรับการจองผ่านหน้าเว็บ

-- CreateTable
CREATE TABLE `property_promo_codes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NULL,
    `discountType` VARCHAR(20) NOT NULL DEFAULT 'percentage',
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `maxDiscount` DECIMAL(12, 2) NULL,
    `minNights` INTEGER NOT NULL DEFAULT 1,
    `minAmount` DECIMAL(12, 2) NULL,
    `validFrom` DATE NULL,
    `validUntil` DATE NULL,
    `usageLimit` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `property_promo_codes_tenantId_propertyId_code_key`(`tenantId`, `propertyId`, `code`),
    INDEX `property_promo_codes_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `promoCodeId` VARCHAR(191) NULL,
    ADD COLUMN `discountAmount` DECIMAL(10, 2) NULL;

-- CreateIndex
CREATE INDEX `bookings_promoCodeId_idx` ON `bookings`(`promoCodeId`);

-- AddForeignKey
ALTER TABLE `property_promo_codes` ADD CONSTRAINT `property_promo_codes_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
