-- Add max_properties column to plans table
ALTER TABLE `plans` ADD COLUMN `max_properties` INT NOT NULL DEFAULT 1;

-- Update existing plans with default values
-- Basic plan: 1 property
-- Standard plan: 3 properties
-- Premium plan: 5 properties
-- Enterprise plan: unlimited (999)

UPDATE `plans` SET `max_properties` = 1 WHERE `code` = 'basic';
UPDATE `plans` SET `max_properties` = 3 WHERE `code` = 'standard';
UPDATE `plans` SET `max_properties` = 5 WHERE `code` = 'premium';
UPDATE `plans` SET `max_properties` = 999 WHERE `code` = 'enterprise';
