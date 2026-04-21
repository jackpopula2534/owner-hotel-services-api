-- ============================================================
-- Migration: add_restaurant_property_id
-- Created: 2026-04-10
-- Description: Add propertyId column to restaurants table
--   with FK reference to properties table
-- ============================================================

-- Add propertyId column
ALTER TABLE `restaurants` ADD COLUMN `propertyId` VARCHAR(191) NULL;

-- Create index
CREATE INDEX `restaurants_propertyId_idx` ON `restaurants`(`propertyId`);

-- Add FK constraint
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_propertyId_fkey`
  FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
