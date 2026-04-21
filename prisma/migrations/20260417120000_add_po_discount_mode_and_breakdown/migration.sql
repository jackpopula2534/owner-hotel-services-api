-- AlterTable: add discount mode / header discount / breakdown to purchase_orders
ALTER TABLE `purchase_orders`
  ADD COLUMN `discountMode` ENUM('BEFORE_VAT', 'AFTER_VAT') NOT NULL DEFAULT 'BEFORE_VAT',
  ADD COLUMN `headerDiscount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `headerDiscountType` ENUM('PERCENT', 'AMOUNT') NOT NULL DEFAULT 'AMOUNT',
  ADD COLUMN `calculationBreakdown` JSON NULL;

-- AlterTable: add discountType to purchase_order_items so both % and absolute
-- amount discounts can be persisted at the line level.
ALTER TABLE `purchase_order_items`
  ADD COLUMN `discountType` ENUM('PERCENT', 'AMOUNT') NOT NULL DEFAULT 'PERCENT';
