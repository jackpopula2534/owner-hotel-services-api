-- วันหยุดของโรงแรมย้ายจาก localStorage ของเบราว์เซอร์มาเก็บที่ server (ใช้คิดราคาวันหยุดทั้งหลังบ้านและหน้าเว็บ)

-- CreateTable
CREATE TABLE `property_holidays` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'custom',
    `date` DATE NOT NULL,
    `endDate` DATE NULL,
    `name` VARCHAR(120) NOT NULL DEFAULT '',
    `category` VARCHAR(20) NOT NULL DEFAULT 'custom',
    `repeatYearly` BOOLEAN NOT NULL DEFAULT false,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `property_holidays_tenantId_propertyId_idx`(`tenantId`, `propertyId`),
    INDEX `property_holidays_propertyId_idx`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `property_holidays` ADD CONSTRAINT `property_holidays_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
