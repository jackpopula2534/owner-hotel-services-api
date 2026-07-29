-- Direct-sale (retail) menu items: link a menu item 1:1 to an inventory item
-- (e.g. bottled water). Completing an order deducts that item directly instead
-- of going through a recipe.

-- AlterTable
ALTER TABLE `menu_items` ADD COLUMN `inventoryItemId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `menu_items_inventoryItemId_idx` ON `menu_items`(`inventoryItemId`);

-- AddForeignKey
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_inventoryItemId_fkey` FOREIGN KEY (`inventoryItemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
