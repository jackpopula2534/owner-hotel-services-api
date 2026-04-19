-- Add per-PO payment terms and delivery address.
-- Previously UI + PDF had to fall back to supplier.paymentTerms, which made
-- PDF always render "-" when the PO wasn't loaded together with its supplier
-- relation. Storing on the PO itself makes the read path single-source.

ALTER TABLE `purchase_orders`
  ADD COLUMN `paymentTerms` VARCHAR(191) NULL,
  ADD COLUMN `deliveryAddress` TEXT NULL;
