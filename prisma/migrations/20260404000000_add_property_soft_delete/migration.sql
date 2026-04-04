-- AlterTable: Add soft delete support to properties
ALTER TABLE `properties` ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `properties_deleted_at_idx` ON `properties`(`deleted_at`);
