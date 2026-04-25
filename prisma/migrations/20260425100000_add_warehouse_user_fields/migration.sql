-- AlterTable: add warehouse user fields to users
-- Mirrors the procurement-user pattern (see approvalLimit + procurementPermissions)
-- so a single User row can hold both procurement and warehouse metadata.
ALTER TABLE `users`
  ADD COLUMN `warehousePermissions` TEXT NULL,
  ADD COLUMN `warehouseIds`         TEXT NULL;
