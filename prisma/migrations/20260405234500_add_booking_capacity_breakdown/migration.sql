-- Migration: add booking capacity breakdown snapshot
-- Purpose: persist standard-bed capacity, extra-bed capacity, and usage per booking

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'baseCapacity'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `baseCapacity` INT NULL DEFAULT 2'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'extraBedCapacity'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `extraBedCapacity` INT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'totalCapacity'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `totalCapacity` INT NULL DEFAULT 2'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'extraBedGuests'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `extraBedGuests` INT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'standardBedGuests'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `standardBedGuests` INT NULL DEFAULT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
