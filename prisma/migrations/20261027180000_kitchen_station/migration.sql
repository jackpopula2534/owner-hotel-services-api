-- Kitchen display stations: which line makes a dish (KITCHEN = ครัว, BAR = บาร์).
-- Set on the category; a menu item may override it. NULL means "follow the
-- category" (item) / "follow revenue type: BEVERAGE → BAR" (category).
ALTER TABLE `menu_categories` ADD COLUMN `kitchenStation` VARCHAR(16) NULL;
ALTER TABLE `menu_items` ADD COLUMN `kitchenStation` VARCHAR(16) NULL;
