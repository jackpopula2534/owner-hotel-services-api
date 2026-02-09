-- Add tenantId to guests table
ALTER TABLE `guests` ADD COLUMN `tenantId` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `nationalId` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `passportNumber` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `dateOfBirth` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `nationality` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `city` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `country` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `postalCode` VARCHAR(191) NULL;
ALTER TABLE `guests` ADD COLUMN `isVip` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `guests` ADD COLUMN `vipLevel` VARCHAR(191) NULL;

-- Add tenantId to rooms table
ALTER TABLE `rooms` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- Add tenantId to bookings table  
ALTER TABLE `bookings` ADD COLUMN `tenantId` VARCHAR(191) NULL;

-- Add tenantId to reviews table
ALTER TABLE `reviews` ADD COLUMN `tenantId` VARCHAR(191) NULL;
