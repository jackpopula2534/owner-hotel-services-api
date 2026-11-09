-- AlterTable: bring supplier_quotes to parity with purchase_orders discount model
ALTER TABLE `supplier_quotes`
  ADD COLUMN `discountMode` ENUM('BEFORE_VAT', 'AFTER_VAT') NOT NULL DEFAULT 'BEFORE_VAT',
  ADD COLUMN `headerDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `headerDiscountType` ENUM('PERCENT', 'AMOUNT') NOT NULL DEFAULT 'AMOUNT',
  ADD COLUMN `pricesIncludeVat` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: allow % or fixed-amount line discounts on quote items
ALTER TABLE `supplier_quote_items`
  ADD COLUMN `discountType` ENUM('PERCENT', 'AMOUNT') NOT NULL DEFAULT 'PERCENT';
