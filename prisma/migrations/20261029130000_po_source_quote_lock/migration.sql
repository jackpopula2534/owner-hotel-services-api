-- Lock a PO to the winning supplier quote; deviations need a reason
ALTER TABLE `purchase_orders`
  ADD COLUMN `sourceQuoteId` VARCHAR(191) NULL,
  ADD COLUMN `priceOverrideReason` TEXT NULL,
  ADD COLUMN `quoteVariance` JSON NULL;

CREATE INDEX `purchase_orders_sourceQuoteId_idx` ON `purchase_orders`(`sourceQuoteId`);
