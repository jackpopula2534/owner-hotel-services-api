-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `link` VARCHAR(500) NULL;

-- CreateIndex
CREATE INDEX `notifications_userId_category_isRead_idx` ON `notifications`(`userId`, `category`, `isRead`);
