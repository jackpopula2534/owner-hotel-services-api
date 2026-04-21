-- AlterTable: Add profile fields to employees table for comprehensive HR form
ALTER TABLE `employees` ADD COLUMN `nickname` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `dateOfBirth` DATETIME(3) NULL;
ALTER TABLE `employees` ADD COLUMN `nationalId` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `gender` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `employmentType` VARCHAR(191) NULL DEFAULT 'FULLTIME';
ALTER TABLE `employees` ADD COLUMN `bankName` VARCHAR(191) NULL;
ALTER TABLE `employees` ADD COLUMN `notes` TEXT NULL;
