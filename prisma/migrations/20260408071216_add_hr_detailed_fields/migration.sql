-- AlterTable
ALTER TABLE `employees` ADD COLUMN `allowance` DECIMAL(12, 2) NULL,
    ADD COLUMN `educations` JSON NULL,
    ADD COLUMN `emergencyContacts` JSON NULL,
    ADD COLUMN `overtime` DECIMAL(12, 2) NULL,
    ADD COLUMN `positionBonus` DECIMAL(12, 2) NULL,
    ADD COLUMN `propertyId` VARCHAR(191) NULL,
    ADD COLUMN `socialSecurity` VARCHAR(191) NULL,
    ADD COLUMN `taxId` VARCHAR(191) NULL,
    ADD COLUMN `workExperiences` JSON NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX `employees_propertyId_idx` ON `employees`(`propertyId`);

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_propertyId_fkey` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
