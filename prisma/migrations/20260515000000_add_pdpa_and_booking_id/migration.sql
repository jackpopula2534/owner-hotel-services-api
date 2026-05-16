-- AlterTable: Add PDPA Consent and Anonymization to employees
-- Using ALTER TABLE without checks as we know these are missing from all migrations
ALTER TABLE `employees` ADD COLUMN `consentGiven` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `consentAt` DATETIME(3) NULL,
    ADD COLUMN `consentVersion` VARCHAR(20) NULL,
    ADD COLUMN `consentIpAddress` VARCHAR(45) NULL,
    ADD COLUMN `anonymizedAt` DATETIME(3) NULL;

-- AlterTable: Add PDPA Consent and Anonymization to guests
ALTER TABLE `guests` ADD COLUMN `consentGiven` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `consentAt` DATETIME(3) NULL,
    ADD COLUMN `consentVersion` VARCHAR(20) NULL,
    ADD COLUMN `consentIpAddress` VARCHAR(45) NULL,
    ADD COLUMN `anonymizedAt` DATETIME(3) NULL;
