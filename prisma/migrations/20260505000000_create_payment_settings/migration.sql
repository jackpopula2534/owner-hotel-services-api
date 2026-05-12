-- CreateTable
CREATE TABLE `payment_settings` (
    `id` VARCHAR(191) NOT NULL,
    `propertyId` VARCHAR(191) NOT NULL,
    `promptpayEnabled` BOOLEAN NOT NULL DEFAULT false,
    `promptpayId` VARCHAR(20) NULL,
    `promptpayAccountName` VARCHAR(200) NULL,
    `bankTransferEnabled` BOOLEAN NOT NULL DEFAULT false,
    `cashEnabled` BOOLEAN NOT NULL DEFAULT true,
    `cashInstructions` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_settings_propertyId_key`(`propertyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_settings` ADD CONSTRAINT `payment_settings_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
