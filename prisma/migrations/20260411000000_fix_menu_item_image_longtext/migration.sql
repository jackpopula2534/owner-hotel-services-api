-- Fix: Change image column from VARCHAR(191) to LONGTEXT to support base64 image strings
ALTER TABLE `menu_items` MODIFY COLUMN `image` LONGTEXT NULL;
