-- Migration: add room child no extra charge fields
-- Purpose: persist child free-of-charge toggle and note for room create/update flows

SET @db = DATABASE();

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'childNoExtraCharge'
  ),
  'SELECT 1',
  'ALTER TABLE `rooms` ADD COLUMN `childNoExtraCharge` BOOLEAN NOT NULL DEFAULT false'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rooms' AND COLUMN_NAME = 'childNoExtraChargeNote'
  ),
  'SELECT 1',
  'ALTER TABLE `rooms` ADD COLUMN `childNoExtraChargeNote` TEXT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
