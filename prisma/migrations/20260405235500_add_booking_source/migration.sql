-- Migration: add booking source
-- Purpose: persist booking source such as DIRECT / WALK_IN / OTA for booking list cards

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'source'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `source` VARCHAR(191) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
