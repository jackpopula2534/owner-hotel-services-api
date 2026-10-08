-- เว็บไซต์โรงแรม (add-on WEBSITE_BUILDER): 1 เว็บต่อ property + กล่องคำขอจอง/ติดต่อจากหน้าเว็บ

-- CreateTable
CREATE TABLE `website_sites` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(40) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `templateKey` VARCHAR(30) NOT NULL DEFAULT 'classic',
    `defaultLang` VARCHAR(5) NOT NULL DEFAULT 'th',
    `theme` JSON NOT NULL,
    `draftContent` JSON NOT NULL,
    `publishedContent` JSON NULL,
    `seo` JSON NOT NULL,
    `publishedTheme` JSON NULL,
    `publishedSeo` JSON NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `website_sites_propertyId_key`(`propertyId`),
    UNIQUE INDEX `website_sites_slug_key`(`slug`),
    INDEX `website_sites_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `website_inquiries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `siteId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(160) NULL,
    `message` TEXT NULL,
    `checkIn` DATE NULL,
    `checkOut` DATE NULL,
    `adults` INTEGER NULL,
    `children` INTEGER NULL,
    `roomType` VARCHAR(120) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'NEW',
    `bookingId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `website_inquiries_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `website_inquiries_siteId_idx`(`siteId`),
    INDEX `website_inquiries_bookingId_idx`(`bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `website_sites` ADD CONSTRAINT `website_sites_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `website_inquiries` ADD CONSTRAINT `website_inquiries_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `website_sites`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `website_inquiries` ADD CONSTRAINT `website_inquiries_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

