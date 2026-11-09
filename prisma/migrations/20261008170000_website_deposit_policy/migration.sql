-- AlterTable
ALTER TABLE `payment_settings` ADD COLUMN `websiteDepositType` VARCHAR(20) NOT NULL DEFAULT 'full',
    ADD COLUMN `websiteDepositValue` DECIMAL(12, 2) NULL;
