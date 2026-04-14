-- AlterTable
ALTER TABLE `audit_logs` ADD COLUMN `category` VARCHAR(191) NULL DEFAULT 'general';

-- CreateIndex
CREATE INDEX `audit_logs_category_idx` ON `audit_logs`(`category`);
