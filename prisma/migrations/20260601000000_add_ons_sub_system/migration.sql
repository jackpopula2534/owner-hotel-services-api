-- Add Sub-System flag + card metadata to add_ons catalog.

ALTER TABLE `add_ons`
  ADD COLUMN `is_sub_system` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `sub_system_meta` TEXT NULL;

CREATE INDEX `IDX_add_ons_is_sub_system` ON `add_ons` (`is_sub_system`);
