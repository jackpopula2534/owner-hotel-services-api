-- AlterTable
ALTER TABLE `properties`
    ADD COLUMN `serviceChargeEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `serviceChargePercent` DOUBLE NOT NULL DEFAULT 10,
    ADD COLUMN `vatEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `vatPercent` DOUBLE NOT NULL DEFAULT 7,
    ADD COLUMN `taxDisplayMode` VARCHAR(191) NOT NULL DEFAULT 'breakdown';
