-- AlterTable: add icon, color, and convert image to LongText for menu_categories
ALTER TABLE `menu_categories`
  ADD COLUMN `icon` VARCHAR(64) NULL,
  ADD COLUMN `color` VARCHAR(16) NULL,
  MODIFY `image` LONGTEXT NULL;
