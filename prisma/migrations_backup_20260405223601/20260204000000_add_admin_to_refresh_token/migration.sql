-- AlterTable
ALTER TABLE `refresh_tokens` ADD COLUMN `adminId` VARCHAR(36) NULL;

-- CreateIndex
CREATE INDEX `refresh_tokens_adminId_idx` ON `refresh_tokens`(`adminId`);

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `admins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
