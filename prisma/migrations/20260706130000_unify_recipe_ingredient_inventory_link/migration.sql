-- Unify recipes: link menu-item recipe ingredients to tracked inventory items.
-- `itemId` (nullable) marks an ingredient as stock-tracked; `wastagePercent`
-- carries the same wastage buffer previously stored only on InventoryRecipe.

ALTER TABLE `recipe_ingredients`
  ADD COLUMN `itemId` VARCHAR(191) NULL,
  ADD COLUMN `wastagePercent` DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

CREATE INDEX `recipe_ingredients_itemId_idx` ON `recipe_ingredients`(`itemId`);

ALTER TABLE `recipe_ingredients`
  ADD CONSTRAINT `recipe_ingredients_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
