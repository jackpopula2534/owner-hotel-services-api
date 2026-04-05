-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `weekendPrice` DOUBLE NULL,
    ADD COLUMN `holidayPriceEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `holidayPriceType` VARCHAR(191) NULL DEFAULT 'percent',
    ADD COLUMN `holidayPrice` DOUBLE NULL,
    ADD COLUMN `holidayPricePercent` DOUBLE NULL,
    ADD COLUMN `seasonalRates` JSON NULL;
