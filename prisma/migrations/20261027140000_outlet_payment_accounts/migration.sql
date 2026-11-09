-- Per-outlet payment policy + uploaded QR images on payment accounts

-- AlterTable
ALTER TABLE `payment_accounts` ADD COLUMN `qrImageUrl` VARCHAR(500) NULL,
    ADD COLUMN `qrProvider` VARCHAR(60) NULL;

-- AlterTable
ALTER TABLE `restaurants` ADD COLUMN `acceptedPaymentMethods` JSON NULL,
    ADD COLUMN `defaultPaymentMethod` VARCHAR(20) NULL,
    ADD COLUMN `qrPaymentAccountId` VARCHAR(191) NULL,
    ADD COLUMN `transferPaymentAccountId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `restaurants_qrPaymentAccountId_idx` ON `restaurants`(`qrPaymentAccountId`);

-- CreateIndex
CREATE INDEX `restaurants_transferPaymentAccountId_idx` ON `restaurants`(`transferPaymentAccountId`);

-- AddForeignKey
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_qrPaymentAccountId_fkey` FOREIGN KEY (`qrPaymentAccountId`) REFERENCES `payment_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_transferPaymentAccountId_fkey` FOREIGN KEY (`transferPaymentAccountId`) REFERENCES `payment_accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
