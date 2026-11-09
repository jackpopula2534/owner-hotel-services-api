-- Sprint 4: Force-close + variance tracking on PurchaseOrder
-- Adds three nullable columns. No backfill required — existing POs that were
-- closed via the normal CLOSED transition simply have NULL force-close fields.

ALTER TABLE `purchase_orders`
  ADD COLUMN `forceClosedAt` DATETIME(3) NULL,
  ADD COLUMN `forceClosedBy` VARCHAR(191) NULL,
  ADD COLUMN `forceClosedReason` TEXT NULL;
