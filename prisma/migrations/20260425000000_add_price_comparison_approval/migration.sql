-- AlterTable: add approval workflow columns to price_comparisons
ALTER TABLE `price_comparisons`
  ADD COLUMN `status` ENUM('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `submittedAt` DATETIME(3) NULL,
  ADD COLUMN `rejectedBy` VARCHAR(191) NULL,
  ADD COLUMN `rejectedAt` DATETIME(3) NULL,
  ADD COLUMN `rejectionReason` TEXT NULL;

-- CreateIndex
CREATE INDEX `price_comparisons_status_idx` ON `price_comparisons`(`status`);
