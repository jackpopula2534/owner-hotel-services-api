-- Migration: add booking occupancy and pricing breakdown details
-- Purpose: persist guest counts and nightly pricing summary for booking detail pages

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'adults'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `adults` INT NULL DEFAULT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'children'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `children` INT NULL DEFAULT 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'numberOfGuests'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `numberOfGuests` INT NULL DEFAULT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'roomSubtotal'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `roomSubtotal` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'serviceChargeAmount'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `serviceChargeAmount` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'vatAmount'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `vatAmount` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'grandTotal'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `grandTotal` DECIMAL(10, 2) NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'pricingBreakdown'
  ),
  'SELECT 1',
  'ALTER TABLE `bookings` ADD COLUMN `pricingBreakdown` JSON NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
