-- AlterTable
ALTER TABLE `conversations` ADD COLUMN `guestId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `conversations_guestId_idx` ON `conversations`(`guestId`);

-- AddForeignKey
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
